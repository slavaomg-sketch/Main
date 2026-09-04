import type { CanonicalImportRow } from '../imports/types.js';

/**
 * MarketplaceAdapter — единый интерфейс для официальных API маркетплейсов.
 * Никакого парсинга публичных страниц: только API продавца.
 * Адаптер активен, только если заданы ключи в окружении; иначе isConfigured() = false
 * и раздел «Импорт» показывает инструкцию по подключению.
 */
export interface MarketplaceAdapter {
  readonly code: 'wildberries' | 'ozon' | 'yandex-market';
  readonly name: string;
  isConfigured(): boolean;
  /** Постранично выгружает карточки продавца в каноническом формате. */
  fetchListings(cursor?: string | null): Promise<{ rows: CanonicalImportRow[]; nextCursor: string | null; raw: unknown[] }>;
  /** Остатки и цены (отдельный лёгкий вызов). */
  fetchPricesAndStocks(): Promise<Array<{ externalId: string; priceMinor?: number; stock?: number }>>;
  /** Отправка цен и остатков в маркетплейс (обратная синхронизация). */
  pushPricesAndStocks?(items: Array<{ externalId: string; priceMinor?: number; stock?: number }>): Promise<{ accepted: number; errors: string[] }>;
}

abstract class BaseAdapter implements MarketplaceAdapter {
  abstract readonly code: MarketplaceAdapter['code'];
  abstract readonly name: string;
  abstract isConfigured(): boolean;
  protected ensure(): void {
    if (!this.isConfigured()) throw new Error(`${this.name}: адаптер не настроен — задайте ключи в .env`);
  }
  abstract fetchListings(cursor?: string | null): Promise<{ rows: CanonicalImportRow[]; nextCursor: string | null; raw: unknown[] }>;
  abstract fetchPricesAndStocks(): Promise<Array<{ externalId: string; priceMinor?: number; stock?: number }>>;
}

/** Wildberries: Content API (карточки) и Prices/Stocks API. Документация: https://dev.wildberries.ru */
export class WildberriesAdapter extends BaseAdapter {
  readonly code = 'wildberries' as const;
  readonly name = 'Wildberries';
  constructor(private readonly token: string) {
    super();
  }
  isConfigured() {
    return Boolean(this.token);
  }
  async fetchListings(cursor?: string | null) {
    this.ensure();
    const body = { settings: { cursor: cursor ? JSON.parse(cursor) : { limit: 100 }, filter: { withPhoto: -1 } } };
    const res = await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list', { method: 'POST', headers: { Authorization: this.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Wildberries cards: HTTP ${res.status}`);
    const data = (await res.json()) as { cards?: Array<Record<string, unknown>>; cursor?: { updatedAt?: string; nmID?: number; total?: number } };
    const cards = data.cards ?? [];
    const rows: CanonicalImportRow[] = cards.map((c) => ({
      externalId: String(c.nmID),
      sku: (c.vendorCode as string) ?? undefined,
      name: (c.title as string) ?? undefined,
      brand: (c.brand as string) ?? undefined,
      category: (c.subjectName as string) ?? undefined,
      description: (c.description as string) ?? undefined,
      imageUrls: ((c.photos as Array<{ big?: string }> | undefined) ?? []).map((p) => p.big).filter((u): u is string => Boolean(u)),
      externalUrl: `https://www.wildberries.ru/catalog/${c.nmID}/detail.aspx`,
      gtin: ((c.sizes as Array<{ skus?: string[] }> | undefined)?.[0]?.skus?.[0]) ?? undefined,
    }));
    const next = data.cursor && cards.length === 100 ? JSON.stringify({ limit: 100, updatedAt: data.cursor.updatedAt, nmID: data.cursor.nmID }) : null;
    return { rows, nextCursor: next, raw: cards };
  }
  async fetchPricesAndStocks() {
    this.ensure();
    const res = await fetch('https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000', { headers: { Authorization: this.token } });
    if (!res.ok) throw new Error(`Wildberries prices: HTTP ${res.status}`);
    const data = (await res.json()) as { data?: { listGoods?: Array<{ nmID: number; sizes?: Array<{ price?: number; discountedPrice?: number }> }> } };
    return (data.data?.listGoods ?? []).map((g) => ({ externalId: String(g.nmID), priceMinor: g.sizes?.[0]?.discountedPrice !== undefined ? Math.round(g.sizes[0].discountedPrice * 100) : undefined }));
  }
}

/** Ozon Seller API. Документация: https://docs.ozon.ru/api/seller */
export class OzonAdapter extends BaseAdapter {
  readonly code = 'ozon' as const;
  readonly name = 'Ozon';
  constructor(private readonly clientId: string, private readonly apiKey: string) {
    super();
  }
  isConfigured() {
    return Boolean(this.clientId && this.apiKey);
  }
  private headers() {
    return { 'Client-Id': this.clientId, 'Api-Key': this.apiKey, 'Content-Type': 'application/json' };
  }
  async fetchListings(cursor?: string | null) {
    this.ensure();
    const res = await fetch('https://api-seller.ozon.ru/v3/product/list', { method: 'POST', headers: this.headers(), body: JSON.stringify({ filter: { visibility: 'ALL' }, last_id: cursor ?? '', limit: 100 }) });
    if (!res.ok) throw new Error(`Ozon product/list: HTTP ${res.status}`);
    const list = (await res.json()) as { result?: { items?: Array<{ product_id: number; offer_id: string }>; last_id?: string } };
    const items = list.result?.items ?? [];
    if (items.length === 0) return { rows: [], nextCursor: null, raw: [] };
    const info = await fetch('https://api-seller.ozon.ru/v3/product/info/list', { method: 'POST', headers: this.headers(), body: JSON.stringify({ product_id: items.map((i) => i.product_id) }) });
    if (!info.ok) throw new Error(`Ozon product/info: HTTP ${info.status}`);
    const details = (await info.json()) as { items?: Array<Record<string, unknown>> };
    const rows: CanonicalImportRow[] = (details.items ?? []).map((p) => ({
      externalId: String(p.id),
      sku: (p.offer_id as string) ?? undefined,
      name: (p.name as string) ?? undefined,
      gtin: ((p.barcodes as string[] | undefined) ?? [])[0],
      priceMinor: p.price ? Math.round(parseFloat(String(p.price)) * 100) : undefined,
      compareAtMinor: p.old_price ? Math.round(parseFloat(String(p.old_price)) * 100) : undefined,
      imageUrls: (p.images as string[] | undefined) ?? [],
      externalUrl: p.sku ? `https://www.ozon.ru/product/${p.sku}` : undefined,
    }));
    return { rows, nextCursor: list.result?.last_id && items.length === 100 ? list.result.last_id : null, raw: details.items ?? [] };
  }
  async fetchPricesAndStocks() {
    this.ensure();
    const res = await fetch('https://api-seller.ozon.ru/v4/product/info/stocks', { method: 'POST', headers: this.headers(), body: JSON.stringify({ filter: { visibility: 'ALL' }, limit: 1000 }) });
    if (!res.ok) throw new Error(`Ozon stocks: HTTP ${res.status}`);
    const data = (await res.json()) as { items?: Array<{ product_id: number; stocks?: Array<{ present?: number }> }> };
    return (data.items ?? []).map((i) => ({ externalId: String(i.product_id), stock: i.stocks?.reduce((s, st) => s + (st.present ?? 0), 0) }));
  }
}

/** Яндекс Маркет: API партнёра. Документация: https://yandex.ru/dev/market/partner-api */
export class YandexMarketAdapter extends BaseAdapter {
  readonly code = 'yandex-market' as const;
  readonly name = 'Яндекс Маркет';
  constructor(private readonly token: string, private readonly campaignId: string) {
    super();
  }
  isConfigured() {
    return Boolean(this.token && this.campaignId);
  }
  async fetchListings(cursor?: string | null) {
    this.ensure();
    const url = new URL(`https://api.partner.market.yandex.ru/campaigns/${this.campaignId}/offer-mapping-entries`);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('page_token', cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`Yandex Market offers: HTTP ${res.status}`);
    const data = (await res.json()) as { result?: { offerMappingEntries?: Array<{ offer?: Record<string, unknown> }>; paging?: { nextPageToken?: string } } };
    const entries = data.result?.offerMappingEntries ?? [];
    const rows: CanonicalImportRow[] = entries.map((e) => {
      const o = e.offer ?? {};
      return {
        externalId: String(o.shopSku ?? ''),
        sku: (o.shopSku as string) ?? undefined,
        name: (o.name as string) ?? undefined,
        brand: (o.vendor as string) ?? undefined,
        gtin: ((o.barcodes as string[] | undefined) ?? [])[0],
        description: (o.description as string) ?? undefined,
        imageUrls: (o.urls as string[] | undefined) ?? [],
      };
    });
    return { rows, nextCursor: data.result?.paging?.nextPageToken ?? null, raw: entries };
  }
  async fetchPricesAndStocks() {
    this.ensure();
    return [];
  }
}
