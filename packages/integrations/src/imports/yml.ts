import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { ImportFileAdapter, ParsedTable } from './types';

/** YML (Яндекс.Маркет) — разбор <offer> в табличную форму и сборка фида каталога. */
export class YmlImportAdapter implements ImportFileAdapter {
  readonly code = 'yml' as const;
  readonly extensions = ['.yml', '.xml'];
  readonly mimeTypes = ['application/xml', 'text/xml'];

  async parse(buffer: Buffer, options: { maxRows?: number } = {}): Promise<ParsedTable> {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, parseAttributeValue: false, isArray: (name) => ['offer', 'picture', 'param', 'category'].includes(name) });
    const doc = parser.parse(buffer.toString('utf8')) as { yml_catalog?: { shop?: { offers?: { offer?: unknown[] }; categories?: { category?: Array<{ '#text'?: string; '@_id'?: string }> } } } };
    const shop = doc.yml_catalog?.shop;
    const categories = new Map<string, string>();
    for (const c of shop?.categories?.category ?? []) if (c['@_id']) categories.set(String(c['@_id']), String(c['#text'] ?? ''));
    const offers = (shop?.offers?.offer ?? []) as Array<Record<string, unknown>>;
    const rows = offers.map((o) => {
      const params = (o.param as Array<{ '#text'?: string; '@_name'?: string }> | undefined) ?? [];
      const row: Record<string, string> = {
        id: String(o['@_id'] ?? ''),
        name: String(o.name ?? o.model ?? ''),
        vendor: String(o.vendor ?? ''),
        vendorCode: String(o.vendorCode ?? ''),
        barcode: String(o.barcode ?? ''),
        categoryId: categories.get(String(o.categoryId ?? '')) ?? String(o.categoryId ?? ''),
        price: String(o.price ?? ''),
        oldprice: String(o.oldprice ?? ''),
        description: String(o.description ?? ''),
        url: String(o.url ?? ''),
        picture: ((o.picture as string[] | undefined) ?? []).join(';'),
        available: String(o['@_available'] ?? ''),
        count: String(o.count ?? ''),
      };
      for (const p of params) if (p['@_name']) row[`param:${p['@_name']}`] = String(p['#text'] ?? '');
      return row;
    });
    const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    return { headers, rows: options.maxRows ? rows.slice(0, options.maxRows) : rows, totalRows: rows.length };
  }
}

export interface YmlOffer {
  id: string;
  url: string;
  price: number; // рубли
  oldPrice?: number;
  currency: string;
  categoryId: string;
  pictures: string[];
  name: string;
  vendor?: string;
  vendorCode?: string;
  barcode?: string;
  description?: string;
  available: boolean;
  count?: number;
  params?: Array<{ name: string; value: string }>;
}

export function buildYmlFeed(input: { shopName: string; company: string; url: string; categories: Array<{ id: string; name: string; parentId?: string }>; offers: YmlOffer[] }): string {
  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true, suppressEmptyNode: true });
  const doc = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    yml_catalog: {
      '@_date': new Date().toISOString().slice(0, 16),
      shop: {
        name: input.shopName,
        company: input.company,
        url: input.url,
        currencies: { currency: { '@_id': 'RUR', '@_rate': '1' } },
        categories: { category: input.categories.map((c) => ({ '@_id': c.id, ...(c.parentId ? { '@_parentId': c.parentId } : {}), '#text': c.name })) },
        offers: {
          offer: input.offers.map((o) => ({
            '@_id': o.id,
            '@_available': o.available ? 'true' : 'false',
            url: o.url,
            price: o.price.toFixed(2),
            ...(o.oldPrice ? { oldprice: o.oldPrice.toFixed(2) } : {}),
            currencyId: 'RUR',
            categoryId: o.categoryId,
            picture: o.pictures,
            name: o.name,
            ...(o.vendor ? { vendor: o.vendor } : {}),
            ...(o.vendorCode ? { vendorCode: o.vendorCode } : {}),
            ...(o.barcode ? { barcode: o.barcode } : {}),
            ...(o.description ? { description: o.description } : {}),
            ...(o.count !== undefined ? { count: o.count } : {}),
            ...(o.params?.length ? { param: o.params.map((p) => ({ '@_name': p.name, '#text': p.value })) } : {}),
          })),
        },
      },
    },
  };
  return builder.build(doc) as string;
}
