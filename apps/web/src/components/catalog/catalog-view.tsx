import { prisma } from '@techmatch/database';
import { listProducts, type ListProductsInput, type ProductSort } from '@techmatch/domain';
import { CatalogFilters } from '@/components/catalog/filters';
import { ProductGrid } from '@/components/catalog/product-grid';
import { SortSelect } from '@/components/catalog/sort-select';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/empty';
import { getActiveDevice, getCustomer } from '@/lib/session';
import { getGuestFavoriteIds } from '@/lib/favorites';
import { PackageSearch } from 'lucide-react';

export type CatalogSearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const all = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

/** Общий серверный компонент каталога для /catalog, /category/[slug], /brand/[slug]. */
export async function CatalogView({ sp, base, fixed = {}, showCategories = true, basePath }: { sp: CatalogSearchParams; base?: Partial<ListProductsInput>; fixed?: Partial<ListProductsInput>; showCategories?: boolean; basePath: string }) {
  const [activeDevice, customer] = await Promise.all([getActiveDevice(), getCustomer()]);
  const favorites = customer ? (await prisma.favorite.findMany({ where: { customerId: customer.customer.id }, select: { productId: true } })).map((f) => f.productId) : await getGuestFavoriteIds();
  const compatOnly = first(sp.compat) === '1' && activeDevice;
  const sort = (first(sp.sort) as ProductSort | undefined) ?? (compatOnly ? 'compat' : 'popular');
  const input: ListProductsInput = {
    ...base,
    brandSlugs: all(sp.brand),
    priceMinMinor: first(sp.min) ? Number(first(sp.min)) * 100 : null,
    priceMaxMinor: first(sp.max) ? Number(first(sp.max)) * 100 : null,
    inStockOnly: first(sp.stock) === '1',
    saleOnly: first(sp.sale) === '1',
    newOnly: first(sp.new) === '1',
    query: first(sp.q) ?? null,
    deviceModelId: compatOnly ? activeDevice.id : null,
    sort,
    page: Number(first(sp.page) ?? 1) || 1,
    perPage: 24,
    ...fixed,
  };
  const result = await listProducts(prisma, input);
  const withCompat = activeDevice && !compatOnly ? await listProducts(prisma, { ...input, deviceModelId: activeDevice.id, includeUnknownCompat: true, page: input.page, perPage: input.perPage }) : null;
  // При активном устройстве показываем метки совместимости, не фильтруя выдачу
  const items = withCompat ? result.items.map((p) => ({ ...p, compatibility: withCompat.items.find((x) => x.id === p.id)?.compatibility ?? p.compatibility })) : result.items;
  const hrefFor = (page: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) for (const x of all(v)) if (k !== 'page') q.append(k, x);
    if (page > 1) q.set('page', String(page));
    const s = q.toString();
    return `${basePath}${s ? `?${s}` : ''}`;
  };
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-8">
      <CatalogFilters facets={result.facets} showCategories={showCategories} activeDevice={activeDevice ? { name: activeDevice.name } : null} />
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-ink-500">{result.total} товаров</p>
          <SortSelect value={sort} allowCompat={Boolean(activeDevice)} />
        </div>
        {items.length > 0 ? (
          <>
            <ProductGrid products={items} favorites={favorites} deviceModelId={activeDevice?.id ?? null} cols={5} priorityCount={5} />
            <Pagination page={result.page} pages={result.pages} hrefFor={hrefFor} />
          </>
        ) : (
          <EmptyState icon={<PackageSearch width={26} height={26} />} title="Ничего не найдено" text="Попробуйте изменить фильтры или сбросить их." />
        )}
      </div>
    </div>
  );
}
