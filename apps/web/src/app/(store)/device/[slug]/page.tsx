import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Info } from 'lucide-react';
import { prisma } from '@techmatch/database';
import { evaluateDeviceCatalog, getDeviceBySlug, isPositiveStatus, listBundles, listProducts, NotFoundError, statusLabel, type CompatibilityStatus } from '@techmatch/domain';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { ProductGrid } from '@/components/catalog/product-grid';
import { UseDeviceButton } from '@/components/devices/use-device-button';
import { BundleCard } from '@/components/catalog/bundle-card';
import { EmptyState } from '@/components/ui/empty';
import { SortSelect } from '@/components/catalog/sort-select';
import { getActiveDeviceId, getCustomer } from '@/lib/session';
import { getGuestFavoriteIds } from '@/lib/favorites';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const d = await prisma.deviceModel.findUnique({ where: { slug }, select: { fullName: true, seoTitle: true, seoDescription: true } });
  if (!d) return { title: 'Устройство не найдено' };
  return { title: d.seoTitle ?? `Аксессуары для ${d.fullName}`, description: d.seoDescription ?? `Совместимые зарядки, кабели, чехлы и другие аксессуары для ${d.fullName} с объяснением совместимости.`, alternates: { canonical: `/device/${slug}` } };
}

const STATUS_ORDER: CompatibilityStatus[] = ['VERIFIED', 'COMPATIBLE', 'COMPATIBLE_WITH_LIMITATIONS', 'UNKNOWN', 'INCOMPATIBLE'];

export default async function DevicePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ category?: string; variant?: string; all?: string; page?: string; sort?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  let device: Awaited<ReturnType<typeof getDeviceBySlug>>;
  try {
    device = await getDeviceBySlug(prisma, slug);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const variant = sp.variant ? device.variants.find((v) => v.slug === sp.variant) ?? null : null;
  const needsVariant = device.variants.length > 1 && !variant;
  const [activeId, customer] = await Promise.all([getActiveDeviceId(), getCustomer()]);
  const favorites = customer ? (await prisma.favorite.findMany({ where: { customerId: customer.customer.id }, select: { productId: true } })).map((f) => f.productId) : await getGuestFavoriteIds();

  const { results } = await evaluateDeviceCatalog(prisma, device.id, { deviceVariantId: variant?.id ?? null });
  const stats: Record<CompatibilityStatus, number> = { VERIFIED: 0, COMPATIBLE: 0, COMPATIBLE_WITH_LIMITATIONS: 0, UNKNOWN: 0, INCOMPATIBLE: 0 };
  for (const r of results.values()) stats[r.status] += 1;

  // Категории аксессуаров, в которых есть подходящие товары
  const positiveIds = Array.from(results.entries()).filter(([, r]) => isPositiveStatus(r.status) || (sp.all && r.status === 'UNKNOWN')).map(([id]) => id);
  const catRows = positiveIds.length ? await prisma.product.groupBy({ by: ['categoryId'], where: { id: { in: positiveIds } }, _count: { _all: true } }) : [];
  const cats = catRows.length ? await prisma.accessoryCategory.findMany({ where: { id: { in: catRows.map((c) => c.categoryId) } }, orderBy: { sortOrder: 'asc' } }) : [];
  const catCounts = new Map(catRows.map((c) => [c.categoryId, c._count._all]));
  const currentCat = sp.category && cats.find((c) => c.slug === sp.category) ? sp.category : null;

  const list = await listProducts(prisma, { deviceModelId: device.id, deviceVariantId: variant?.id ?? null, categorySlug: currentCat, includeUnknownCompat: Boolean(sp.all), page: Number(sp.page ?? 1) || 1, perPage: 24, sort: (sp.sort as 'compat' | 'price_asc' | 'price_desc' | 'popular' | undefined) ?? 'compat' });
  const bundles = await listBundles(prisma, { deviceModelId: device.id, limit: 3 });
  const href = (over: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const base: Record<string, string | undefined> = { category: currentCat ?? undefined, variant: variant?.slug, all: sp.all, sort: sp.sort };
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) q.set(k, v);
    const s = q.toString();
    return `/device/${slug}${s ? `?${s}` : ''}`;
  };
  const isActive = activeId === device.id;

  return (
    <div className="shell py-5" data-testid="device-page">
      <Breadcrumbs items={[{ label: 'Подбор по устройству', href: '/devices' }, { label: device.category.name, href: `/devices/${device.category.slug}` }, { label: device.name }]} />
      <section className="card flex flex-col gap-5 p-5 md:flex-row md:items-center md:gap-7">
        <div className="relative size-28 shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-ink-100 md:size-36">
          {device.imageUrl && <Image src={device.imageUrl} alt={device.fullName} fill sizes="144px" className="object-cover" priority />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-ink-500">{device.brand.name} · {device.category.name}{device.releaseYear ? ` · ${device.releaseYear}` : ''}</p>
          <h1 className="h2 mt-0.5 sm:text-[28px]">{device.fullName}</h1>
          {device.identifiers.length > 0 && <p className="mt-1 text-[12px] text-ink-500">Номера модели: {device.identifiers.map((i) => `${i.value}${i.region ? ` (${i.region})` : ''}`).join(', ')}</p>}
          {device.specsAreDemo && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-warning-100 px-2.5 py-1 text-[12px] text-warning-500"><Info width={14} height={14} /> Часть характеристик — демонстрационные, требуют подтверждения</p>
          )}
          {device.variants.length > 1 && (
            <div className="mt-3" data-testid="variant-picker">
              <p className="mb-1.5 text-[12px] font-medium text-ink-700">{needsVariant ? 'Уточните модификацию:' : 'Модификация:'}</p>
              <div className="flex flex-wrap gap-2">
                {device.variants.map((v) => (
                  <Link key={v.id} href={href({ variant: v.slug })} className={`chip ${variant?.id === v.id ? 'bg-brand-500 text-white hover:bg-brand-600' : ''}`} aria-current={variant?.id === v.id ? 'true' : undefined}>
                    {v.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <UseDeviceButton deviceModelId={device.id} deviceVariantId={variant?.id ?? null} active={isActive} loggedIn={Boolean(customer)} />
            <span className="text-[12.5px] text-ink-500">
              Подходит: <b className="text-ink-900">{stats.VERIFIED + stats.COMPATIBLE + stats.COMPATIBLE_WITH_LIMITATIONS}</b> товаров
              {stats.COMPATIBLE_WITH_LIMITATIONS > 0 && <> · с ограничениями: {stats.COMPATIBLE_WITH_LIMITATIONS}</>}
              {stats.UNKNOWN > 0 && <> · не подтверждено: {stats.UNKNOWN}</>}
            </span>
          </div>
        </div>
      </section>

      {needsVariant && (
        <p className="mt-4 rounded-[var(--radius-md)] bg-warning-100 px-4 py-3 text-[13px] text-warning-500" data-testid="needs-variant">
          У этой модели несколько модификаций. Выберите свою выше — часть аксессуаров (например, ремешки) зависит от размера корпуса.
        </p>
      )}

      <section className="mt-6" aria-labelledby="compat-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="compat-title" className="h2">Совместимые аксессуары</h2>
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <Link href={href({ all: sp.all ? null : '1' })} className="text-ink-600 hover:underline">{sp.all ? 'Скрыть неподтверждённые' : 'Показать неподтверждённые'}</Link>
            <SortSelect value={sp.sort ?? 'compat'} allowCompat />
          </div>
        </div>
        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0" data-testid="category-tabs">
          <Link href={href({ category: null })} className={`chip shrink-0 ${!currentCat ? 'bg-ink-900 text-white hover:bg-ink-800' : ''}`}>Все ({positiveIds.length})</Link>
          {cats.map((c) => (
            <Link key={c.id} href={href({ category: c.slug })} className={`chip shrink-0 ${currentCat === c.slug ? 'bg-ink-900 text-white hover:bg-ink-800' : ''}`}>
              {c.name} ({catCounts.get(c.id) ?? 0})
            </Link>
          ))}
        </div>
        {list.items.length > 0 ? (
          <ProductGrid products={list.items} favorites={favorites} deviceModelId={device.id} cols={5} />
        ) : (
          <EmptyState title="Пока нет подтверждённых аксессуаров" text="Мы добавляем совместимость по мере проверки. Попробуйте показать неподтверждённые товары или посмотрите весь каталог." action={<Link href="/catalog" className="btn btn-outline">Весь каталог</Link>} />
        )}
        {list.pages > 1 && (
          <div className="mt-6 flex justify-center gap-2">
            {list.page > 1 && <Link className="btn btn-outline btn-sm" href={`${href({})}${href({}).includes('?') ? '&' : '?'}page=${list.page - 1}`}>Назад</Link>}
            <span className="inline-flex items-center text-[13px] text-ink-500">Страница {list.page} из {list.pages}</span>
            {list.page < list.pages && <Link className="btn btn-outline btn-sm" href={`${href({})}${href({}).includes('?') ? '&' : '?'}page=${list.page + 1}`}>Вперёд</Link>}
          </div>
        )}
      </section>

      {bundles.length > 0 && (
        <section className="mt-8">
          <h2 className="h2 mb-3">Готовые комплекты для {device.name}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {bundles.map((b) => (
              <BundleCard key={b.id} bundle={b} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        {STATUS_ORDER.filter((s) => stats[s] > 0 && s !== 'INCOMPATIBLE').map((s) => (
          <div key={s} className="card p-4 text-[13px]">
            <div className="font-semibold">{statusLabel(s)}: {stats[s]}</div>
            <p className="mt-1 text-ink-500">
              {s === 'VERIFIED' && 'Подтверждено производителем или специалистами TechMatch.'}
              {s === 'COMPATIBLE' && 'Совместимость вычислена по техническим характеристикам устройства и товара.'}
              {s === 'COMPATIBLE_WITH_LIMITATIONS' && 'Будет работать, но не на полную мощность или с оговоркой — подробности в карточке товара.'}
              {s === 'UNKNOWN' && 'Недостаточно данных для вердикта. Скрыты по умолчанию.'}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}
