import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEnv } from '@techmatch/config';
import { prisma } from '@techmatch/database';
import { availableQuantity, checkCompatibility, getProductBySlug, listBundles, listCompatibleDevicesForProduct, NotFoundError, relatedProducts } from '@techmatch/domain';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Gallery } from '@/components/catalog/gallery';
import { BuyBox } from '@/components/catalog/buy-box';
import { CompatPanel } from '@/components/catalog/compat-panel';
import { CompatBadge } from '@/components/ui/compat-badge';
import { Rating } from '@/components/ui/rating';
import { ProductGrid } from '@/components/catalog/product-grid';
import { BundleCard } from '@/components/catalog/bundle-card';
import { getActiveDevice, getCustomer } from '@/lib/session';
import { getGuestFavoriteIds } from '@/lib/favorites';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await prisma.product.findUnique({ where: { slug }, select: { name: true, seoTitle: true, seoDescription: true, shortDescription: true, images: { take: 1, include: { asset: true } } } });
  if (!p) return { title: 'Товар не найден' };
  return { title: p.seoTitle ?? p.name, description: p.seoDescription ?? p.shortDescription ?? undefined, alternates: { canonical: `/product/${slug}` }, openGraph: { images: p.images[0] ? [p.images[0].asset.publicUrl] : [] } };
}

export default async function ProductPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ variant?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  let product: Awaited<ReturnType<typeof getProductBySlug>>;
  try {
    product = await getProductBySlug(prisma, slug);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const variants = product.variants.filter((v) => v.prices.length > 0).map((v) => ({ id: v.id, sku: v.sku, name: v.name, priceMinor: v.prices[0]!.amountMinor, compareAtMinor: v.prices[0]!.compareAtMinor, available: availableQuantity(v.inventory), optionValues: v.optionValues as Record<string, string> }));
  const selected = (sp.variant && variants.find((v) => v.sku === sp.variant)) ?? variants.find((v) => v.available > 0) ?? variants[0];
  if (!selected) notFound();
  const [activeDevice, customer] = await Promise.all([getActiveDevice(), getCustomer()]);
  const [compat, devices, related, bundles] = await Promise.all([
    activeDevice ? checkCompatibility(prisma, { productId: product.id, deviceModelId: activeDevice.id, variantId: selected.id, log: true }) : null,
    listCompatibleDevicesForProduct(prisma, product.id, { limit: 24 }),
    relatedProducts(prisma, product, 5),
    listBundles(prisma).then((all) => all.filter((b) => b.items.some((i) => i.variant.product.slug === product.slug)).slice(0, 3)),
  ]);
  const favorites = customer ? (await prisma.favorite.findMany({ where: { customerId: customer.customer.id }, select: { productId: true } })).map((f) => f.productId) : await getGuestFavoriteIds();
  const variantImages = product.variants.find((v) => v.id === selected.id)?.images ?? [];
  const images = [...variantImages, ...product.images].map((i) => ({ url: i.asset.publicUrl, large: (i.asset.variants as Record<string, string>).large ?? i.asset.publicUrl, thumb: (i.asset.variants as Record<string, string>).thumb ?? i.asset.publicUrl, alt: i.alt ?? product.name }));
  const specAttrs = product.attributes.filter((a) => a.attribute.code.startsWith('spec_') && !a.variantId);
  const visibleAttrs = specAttrs.length ? specAttrs : product.attributes.filter((a) => a.attribute.isVisible && !a.variantId && typeof a.value !== 'object');
  const env = getEnv();
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    image: images.map((i) => `${env.APP_URL}${i.url}`),
    description: product.shortDescription ?? undefined,
    sku: selected.sku,
    brand: product.brand ? { '@type': 'Brand', name: product.brand.name } : undefined,
    aggregateRating: product.reviewCount > 0 ? { '@type': 'AggregateRating', ratingValue: product.rating, reviewCount: product.reviewCount } : undefined,
    offers: { '@type': 'Offer', url: `${env.APP_URL}/product/${product.slug}`, priceCurrency: 'RUB', price: (selected.priceMinor / 100).toFixed(2), availability: selected.available > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' },
  };
  return (
    <div className="shell py-5" data-testid="product-page">
      <Breadcrumbs items={[{ label: 'Каталог', href: '/catalog' }, { label: product.category.name, href: `/category/${product.category.slug}` }, { label: product.name }]} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_340px]">
        <div><Gallery images={images} name={product.name} /></div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-500">
            {product.brand && <Link href={`/brand/${product.brand.slug}`} className="font-semibold text-brand-500 hover:underline">{product.brand.name}</Link>}
            <span>·</span>
            <Link href={`/category/${product.category.slug}`} className="hover:underline">{product.category.name}</Link>
          </div>
          <h1 className="h2 mt-1 sm:text-[26px]">{product.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Rating value={product.rating} count={product.reviewCount} size={15} />
            {product.badges.map((b) => <span key={b} className="badge bg-ink-100 text-ink-700">{b}</span>)}
          </div>
          {compat && (
            <div className="mt-3" data-testid="compat-inline"><CompatBadge status={compat.status} /> <span className="text-[12.5px] text-ink-600">с {activeDevice!.name}</span></div>
          )}
          {product.shortDescription && <p className="mt-3 text-[14.5px] leading-relaxed text-ink-700">{product.shortDescription}</p>}
          {visibleAttrs.length > 0 && (
            <div className="mt-5">
              <h2 className="h3 mb-2">Характеристики</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                {visibleAttrs.map((a) => (
                  <div key={a.id} className="contents">
                    <dt className="text-ink-500">{a.attribute.name}</dt>
                    <dd className="font-medium">{String(a.value)}{a.attribute.unit ? ` ${a.attribute.unit}` : ''}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {product.packageContents.length > 0 && (
            <div className="mt-5">
              <h2 className="h3 mb-2">Комплектация</h2>
              <ul className="list-disc pl-5 text-[13px] text-ink-700">
                {product.packageContents.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          )}
        </div>
        <div className="space-y-4 lg:sticky lg:top-32 lg:self-start">
          <BuyBox productId={product.id} variants={variants} selectedId={selected.id} favorite={favorites.includes(product.id)} deviceModelId={activeDevice?.id ?? null} warrantyMonths={product.warrantyMonths} />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <CompatPanel device={activeDevice ? { name: activeDevice.name, slug: activeDevice.slug } : null} result={compat} devicesCount={devices.length} />
          {devices.length > 0 && (
            <section className="card p-5" aria-labelledby="devices-heading">
              <h2 id="devices-heading" className="h3 mb-3">Совместимые устройства</h2>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="compatible-devices">
                {devices.map(({ device, result }) => (
                  <li key={device.id}>
                    <Link href={`/device/${device.slug}`} className="flex items-center gap-3 rounded-[var(--radius-sm)] p-2 hover:bg-ink-50">
                      <span className="relative size-10 shrink-0 overflow-hidden rounded-[6px] bg-white">{device.imageUrl && <Image src={device.imageUrl} alt="" fill sizes="40px" className="object-contain" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{device.fullName}</span>
                        <CompatBadge status={result.status} short className="mt-0.5" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {product.description && (
            <section className="card p-5">
              <h2 className="h3 mb-2">Описание</h2>
              <p className="text-[14px] leading-relaxed whitespace-pre-line text-ink-700">{product.description}</p>
            </section>
          )}
          <section className="card p-5" aria-labelledby="reviews-heading">
            <h2 id="reviews-heading" className="h3 mb-3">Отзывы {product.reviewCount > 0 && <span className="font-normal text-ink-500">({product.reviewCount})</span>}</h2>
            {product.reviews.length ? (
              <ul className="space-y-4">
                {product.reviews.map((r) => (
                  <li key={r.id} className="border-b border-ink-100 pb-4 last:border-0 last:pb-0">
                    <div className="flex items-center gap-2 text-[13px]"><b>{r.authorName}</b><Rating value={r.rating} /><span className="text-ink-400">{formatDate(r.createdAt)}</span></div>
                    <p className="mt-1 text-[13.5px] text-ink-700">{r.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-500">Отзывов пока нет.</p>
            )}
          </section>
        </div>
        <div className="space-y-6">
          {bundles.length > 0 && (
            <section>
              <h2 className="h3 mb-3">Комплекты с этим товаром</h2>
              <div className="grid gap-4">{bundles.map((b) => <BundleCard key={b.id} bundle={b} />)}</div>
            </section>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-8">
          <h2 className="h2 mb-4">Похожие товары</h2>
          <ProductGrid products={related} favorites={favorites} deviceModelId={activeDevice?.id ?? null} cols={5} />
        </section>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </div>
  );
}
