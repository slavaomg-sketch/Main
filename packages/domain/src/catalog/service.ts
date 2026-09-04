import type { DbClient, Prisma } from '@techmatch/database';
import { NotFoundError } from '../shared/errors.js';
import { normalizeSearchText } from '../shared/normalize.js';
import type { CompatibilityResult } from '../compatibility/types.js';
import { evaluateDeviceCatalog } from '../compatibility/service.js';
import { isPositiveStatus } from '../compatibility/engine.js';

export interface ProductCardDTO {
  id: string;
  slug: string;
  name: string;
  brand: { name: string; slug: string } | null;
  category: { name: string; slug: string };
  image: { url: string; alt: string; variants: Record<string, string> } | null;
  priceMinor: number;
  compareAtMinor: number | null;
  inStock: boolean;
  stockQuantity: number;
  rating: number;
  reviewCount: number;
  badges: string[];
  isNew: boolean;
  defaultVariantId: string;
  variantCount: number;
  variantOptions: Array<{ id: string; name: string; inStock: boolean; priceMinor: number }>;
  compatibility?: Pick<CompatibilityResult, 'status' | 'confidence' | 'explanation' | 'limitations'> | null;
}

export const productCardInclude = {
  brand: { select: { name: true, slug: true } },
  category: { select: { name: true, slug: true } },
  images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }], take: 1, include: { asset: true } },
  variants: {
    where: { status: 'ACTIVE' as const },
    orderBy: [{ isDefault: 'desc' as const }, { sortOrder: 'asc' as const }],
    include: {
      prices: { where: { priceList: 'retail', validFrom: { lte: new Date() }, OR: [{ validTo: null }, { validTo: { gt: new Date() } }] }, orderBy: { validFrom: 'desc' as const }, take: 1 },
      inventory: true,
    },
  },
} satisfies Prisma.ProductInclude;

export type ProductCardRow = Prisma.ProductGetPayload<{ include: typeof productCardInclude }>;

export function availableQuantity(inv: Array<{ quantity: number; reservedQuantity: number }>): number {
  return inv.reduce((s, i) => s + Math.max(0, i.quantity - i.reservedQuantity), 0);
}

export function toProductCard(row: ProductCardRow, compatibility?: CompatibilityResult | null): ProductCardDTO | null {
  const variants = row.variants.filter((v) => v.prices.length > 0);
  if (variants.length === 0) return null;
  const withStock = variants.map((v) => ({ v, qty: availableQuantity(v.inventory) }));
  const preferred = withStock.find((x) => x.v.isDefault && x.qty > 0) ?? withStock.find((x) => x.qty > 0) ?? withStock[0]!;
  const price = preferred.v.prices[0]!;
  const img = row.images[0];
  const totalQty = withStock.reduce((s, x) => s + x.qty, 0);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    category: row.category,
    image: img ? { url: img.asset.publicUrl, alt: img.alt ?? row.name, variants: (img.asset.variants as Record<string, string>) ?? {} } : null,
    priceMinor: price.amountMinor,
    compareAtMinor: price.compareAtMinor,
    inStock: totalQty > 0,
    stockQuantity: totalQty,
    rating: row.rating,
    reviewCount: row.reviewCount,
    badges: row.badges,
    isNew: row.isNew,
    defaultVariantId: preferred.v.id,
    variantCount: variants.length,
    variantOptions: withStock.map((x) => ({ id: x.v.id, name: x.v.name, inStock: x.qty > 0, priceMinor: x.v.prices[0]!.amountMinor })),
    compatibility: compatibility ? { status: compatibility.status, confidence: compatibility.confidence, explanation: compatibility.explanation, limitations: compatibility.limitations } : compatibility === null ? null : undefined,
  };
}

export type ProductSort = 'popular' | 'price_asc' | 'price_desc' | 'new' | 'rating' | 'compat';

export interface ListProductsInput {
  categorySlug?: string | null;
  brandSlugs?: string[];
  query?: string | null;
  priceMinMinor?: number | null;
  priceMaxMinor?: number | null;
  inStockOnly?: boolean;
  featuredOnly?: boolean;
  newOnly?: boolean;
  saleOnly?: boolean;
  productIds?: string[];
  deviceModelId?: string | null;
  deviceVariantId?: string | null;
  includeUnknownCompat?: boolean;
  sort?: ProductSort;
  page?: number;
  perPage?: number;
}

export interface ListProductsResult {
  items: ProductCardDTO[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  facets: {
    brands: Array<{ slug: string; name: string; count: number }>;
    categories: Array<{ slug: string; name: string; count: number }>;
    priceMinMinor: number;
    priceMaxMinor: number;
  };
}

/** Каталог с фильтрами, сортировкой, фасетами и (опционально) фильтром совместимости с устройством. */
export async function listProducts(db: DbClient, input: ListProductsInput): Promise<ListProductsResult> {
  const page = Math.max(1, input.page ?? 1);
  const perPage = Math.min(60, Math.max(1, input.perPage ?? 24));

  const where: Prisma.ProductWhereInput = { status: 'ACTIVE' };
  if (input.categorySlug) {
    const cat = await db.accessoryCategory.findUnique({ where: { slug: input.categorySlug }, select: { id: true, children: { select: { id: true } } } });
    if (!cat) throw new NotFoundError('Категория', input.categorySlug);
    where.categoryId = { in: [cat.id, ...cat.children.map((c) => c.id)] };
  }
  if (input.brandSlugs?.length) where.brand = { slug: { in: input.brandSlugs } };
  if (input.featuredOnly) where.isFeatured = true;
  if (input.newOnly) where.isNew = true;
  if (input.productIds) where.id = { in: input.productIds };
  if (input.query) {
    const q = normalizeSearchText([input.query]);
    const ids = await db.$queryRaw<Array<{ id: string }>>`
      SELECT p.id FROM "Product" p
      LEFT JOIN "ProductVariant" v ON v."productId" = p.id
      WHERE p.status = 'ACTIVE' AND (
        p."searchText" ILIKE ${'%' + q + '%'}
        OR similarity(coalesce(p."searchText", ''), ${q}) > 0.2
        OR lower(v.sku) = ${input.query.toLowerCase()}
        OR to_tsvector('simple', coalesce(p."searchText", '')) @@ plainto_tsquery('simple', ${q})
      )
      GROUP BY p.id
      ORDER BY MAX(similarity(coalesce(p."searchText", ''), ${q})) DESC
      LIMIT 300`;
    const found = ids.map((r) => r.id);
    where.id = input.productIds ? { in: found.filter((id) => input.productIds!.includes(id)) } : { in: found };
  }

  const rows = await db.product.findMany({ where, include: productCardInclude, orderBy: [{ popularity: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }] });

  let compat: Map<string, CompatibilityResult> | null = null;
  if (input.deviceModelId) {
    const ev = await evaluateDeviceCatalog(db, input.deviceModelId, { deviceVariantId: input.deviceVariantId });
    compat = ev.results;
  }

  let cards = rows
    .map((r) => toProductCard(r, compat ? (compat.get(r.id) ?? null) : undefined))
    .filter((c): c is ProductCardDTO => c !== null);

  if (compat) {
    cards = cards.filter((c) => {
      const s = c.compatibility?.status;
      if (!s) return false;
      if (s === 'UNKNOWN') return Boolean(input.includeUnknownCompat);
      return isPositiveStatus(s);
    });
  }
  const facetSource = cards;
  const priceValues = facetSource.map((c) => c.priceMinor);
  const priceMinMinor = priceValues.length ? Math.min(...priceValues) : 0;
  const priceMaxMinor = priceValues.length ? Math.max(...priceValues) : 0;

  if (input.inStockOnly) cards = cards.filter((c) => c.inStock);
  if (input.saleOnly) cards = cards.filter((c) => c.compareAtMinor && c.compareAtMinor > c.priceMinor);
  if (input.priceMinMinor != null) cards = cards.filter((c) => c.priceMinor >= input.priceMinMinor!);
  if (input.priceMaxMinor != null) cards = cards.filter((c) => c.priceMinor <= input.priceMaxMinor!);

  const sort = input.sort ?? (compat ? 'compat' : 'popular');
  const rank: Record<string, number> = { VERIFIED: 4, COMPATIBLE: 3, COMPATIBLE_WITH_LIMITATIONS: 2, UNKNOWN: 1, INCOMPATIBLE: 0 };
  cards.sort((a, b) => {
    switch (sort) {
      case 'price_asc':
        return a.priceMinor - b.priceMinor;
      case 'price_desc':
        return b.priceMinor - a.priceMinor;
      case 'rating':
        return b.rating - a.rating || b.reviewCount - a.reviewCount;
      case 'new':
        return Number(b.isNew) - Number(a.isNew);
      case 'compat':
        return (rank[b.compatibility?.status ?? 'UNKNOWN'] ?? 0) - (rank[a.compatibility?.status ?? 'UNKNOWN'] ?? 0) || (b.compatibility?.confidence ?? 0) - (a.compatibility?.confidence ?? 0);
      default:
        return 0;
    }
  });
  if (input.query && sort === 'popular') {
    // сохраняем порядок релевантности из SQL
    const order = new Map(rows.map((r, i) => [r.id, i]));
    cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  const brandCounts = new Map<string, { name: string; count: number }>();
  const catCounts = new Map<string, { name: string; count: number }>();
  for (const c of facetSource) {
    if (c.brand) brandCounts.set(c.brand.slug, { name: c.brand.name, count: (brandCounts.get(c.brand.slug)?.count ?? 0) + 1 });
    catCounts.set(c.category.slug, { name: c.category.name, count: (catCounts.get(c.category.slug)?.count ?? 0) + 1 });
  }
  const total = cards.length;
  return {
    items: cards.slice((page - 1) * perPage, page * perPage),
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
    facets: {
      brands: Array.from(brandCounts, ([slug, v]) => ({ slug, ...v })).sort((a, b) => b.count - a.count),
      categories: Array.from(catCounts, ([slug, v]) => ({ slug, ...v })).sort((a, b) => b.count - a.count),
      priceMinMinor,
      priceMaxMinor,
    },
  };
}

export const productPageInclude = {
  brand: true,
  category: { include: { parent: true } },
  images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }], include: { asset: true } },
  attributes: { include: { attribute: true }, orderBy: { attribute: { sortOrder: 'asc' as const } } },
  variants: {
    where: { status: 'ACTIVE' as const },
    orderBy: [{ isDefault: 'desc' as const }, { sortOrder: 'asc' as const }],
    include: {
      prices: { where: { priceList: 'retail', validFrom: { lte: new Date() }, OR: [{ validTo: null }, { validTo: { gt: new Date() } }] }, orderBy: { validFrom: 'desc' as const }, take: 1 },
      inventory: true,
      images: { include: { asset: true } },
    },
  },
  reviews: { where: { isApproved: true }, orderBy: { createdAt: 'desc' as const }, take: 10 },
} satisfies Prisma.ProductInclude;

export type ProductPageRow = Prisma.ProductGetPayload<{ include: typeof productPageInclude }>;

export async function getProductBySlug(db: DbClient, slug: string): Promise<ProductPageRow> {
  const product = await db.product.findUnique({ where: { slug }, include: productPageInclude });
  if (!product || product.status !== 'ACTIVE') throw new NotFoundError('Товар', slug);
  return product;
}

export async function getProductCardsByIds(db: DbClient, ids: string[], deviceModelId?: string | null): Promise<ProductCardDTO[]> {
  if (ids.length === 0) return [];
  const rows = await db.product.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, include: productCardInclude });
  const compat = deviceModelId ? (await evaluateDeviceCatalog(db, deviceModelId)).results : null;
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows
    .map((r) => toProductCard(r, compat ? (compat.get(r.id) ?? null) : undefined))
    .filter((c): c is ProductCardDTO => c !== null)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function listAccessoryCategories(db: DbClient) {
  return db.accessoryCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, include: { children: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } }, _count: { select: { products: { where: { status: 'ACTIVE' } } } } } });
}

export async function getAccessoryCategory(db: DbClient, slug: string) {
  const cat = await db.accessoryCategory.findUnique({ where: { slug }, include: { parent: true, children: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } } });
  if (!cat || !cat.isActive) throw new NotFoundError('Категория', slug);
  return cat;
}

export async function listProductBrands(db: DbClient, opts: { popularOnly?: boolean } = {}) {
  return db.productBrand.findMany({ where: { isActive: true, ...(opts.popularOnly ? { isPopular: true } : {}) }, orderBy: { sortOrder: 'asc' }, include: { _count: { select: { products: { where: { status: 'ACTIVE' } } } } } });
}

export async function getProductBrand(db: DbClient, slug: string) {
  const b = await db.productBrand.findUnique({ where: { slug } });
  if (!b || !b.isActive) throw new NotFoundError('Бренд', slug);
  return b;
}

/** Сопутствующие товары: та же категория или та же совместимость. */
export async function relatedProducts(db: DbClient, product: { id: string; categoryId: string }, limit = 6) {
  const rows = await db.product.findMany({ where: { status: 'ACTIVE', categoryId: product.categoryId, id: { not: product.id } }, include: productCardInclude, orderBy: { popularity: 'desc' }, take: limit });
  return rows.map((r) => toProductCard(r)).filter((c): c is ProductCardDTO => c !== null);
}

/** Пересобирает searchText товара (вызывается при создании/обновлении/импорте). */
export function buildProductSearchText(p: { name: string; brandName?: string | null; categoryName?: string | null; skus?: string[]; shortDescription?: string | null }): string {
  return normalizeSearchText([p.name, p.brandName, p.categoryName, ...(p.skus ?? []), p.shortDescription]);
}

/** Быстрые подсказки для глобального поиска: товары + устройства. */
export async function suggestProducts(db: DbClient, query: string, limit = 5) {
  const q = normalizeSearchText([query]);
  if (q.length < 2) return [];
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT p.id FROM "Product" p
    WHERE p.status = 'ACTIVE' AND (p."searchText" ILIKE ${'%' + q + '%'} OR similarity(coalesce(p."searchText",''), ${q}) > 0.25)
    ORDER BY similarity(coalesce(p."searchText",''), ${q}) DESC, p.popularity DESC
    LIMIT ${limit}`;
  return getProductCardsByIds(db, rows.map((r) => r.id));
}
