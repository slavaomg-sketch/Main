import type { Metadata } from 'next';
import { prisma } from '@techmatch/database';
import { listProducts, searchDevices } from '@techmatch/domain';
import { ProductGrid } from '@/components/catalog/product-grid';
import { DeviceCard } from '@/components/devices/device-card';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { EmptyState } from '@/components/ui/empty';
import { Pagination } from '@/components/ui/pagination';
import { getActiveDeviceId, getCustomer } from '@/lib/session';
import { getGuestFavoriteIds } from '@/lib/favorites';
import { SearchX } from 'lucide-react';

export const metadata: Metadata = { title: 'Поиск' };
export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const page = Number(sp.page ?? 1) || 1;
  const [deviceModelId, customer] = await Promise.all([getActiveDeviceId(), getCustomer()]);
  const favorites = customer ? (await prisma.favorite.findMany({ where: { customerId: customer.customer.id }, select: { productId: true } })).map((f) => f.productId) : await getGuestFavoriteIds();
  const [devices, products] = q.length >= 2 ? await Promise.all([searchDevices(prisma, q, { limit: 4, log: true }), listProducts(prisma, { query: q, page, perPage: 24, deviceModelId: null })]) : [null, null];
  if (products && q) {
    await prisma.searchQueryLog.create({ data: { query: q.slice(0, 200), normalized: q.toLowerCase().slice(0, 200), scope: 'PRODUCT', resultCount: products.total } }).catch(() => undefined);
  }
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: 'Поиск' }]} />
      <h1 className="h2 mb-4">{q ? `Результаты по запросу «${q}»` : 'Поиск'}</h1>
      {devices && devices.candidates.length > 0 && (
        <section className="mb-6">
          <h2 className="h3 mb-3">Устройства</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {devices.candidates.map((c) => (
              <DeviceCard key={c.id} device={c} />
            ))}
          </div>
        </section>
      )}
      {products && (
        <section>
          <h2 className="h3 mb-3">Товары {products.total > 0 && <span className="font-normal text-ink-500">({products.total})</span>}</h2>
          {products.items.length > 0 ? (
            <>
              <ProductGrid products={products.items} favorites={favorites} deviceModelId={deviceModelId} />
              <Pagination page={products.page} pages={products.pages} hrefFor={(p) => `/search?q=${encodeURIComponent(q)}&page=${p}`} />
            </>
          ) : (
            <EmptyState icon={<SearchX width={26} height={26} />} title="Товары не найдены" text="Попробуйте другое название, артикул или бренд." />
          )}
        </section>
      )}
    </div>
  );
}
