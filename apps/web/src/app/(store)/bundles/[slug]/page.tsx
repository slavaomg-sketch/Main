import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { formatRub, getBundleBySlug } from '@techmatch/domain';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { bundlePricing } from '@/components/catalog/bundle-card';
import { AddBundleButton } from '@/components/cart/add-bundle-button';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const b = await prisma.bundle.findUnique({ where: { slug } });
  return { title: b?.name ?? 'Комплект', description: b?.description ?? undefined };
}

export default async function BundlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await getBundleBySlug(prisma, slug);
  if (!bundle) notFound();
  const p = bundlePricing(bundle);
  const img = bundle.imageAsset ? ((bundle.imageAsset.variants as Record<string, string>).large ?? bundle.imageAsset.publicUrl) : null;
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: 'Готовые комплекты', href: '/bundles' }, { label: bundle.name }]} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          <div className="relative aspect-[16/9] overflow-hidden rounded-[var(--radius-lg)] bg-ink-100">{img && <Image src={img} alt={bundle.name} fill sizes="(max-width: 1024px) 100vw, 800px" className="object-cover" priority />}</div>
          <h1 className="h2 mt-5">{bundle.name}</h1>
          {bundle.description && <p className="mt-2 text-[15px] text-ink-700">{bundle.description}</p>}
          {bundle.devices.length > 0 && (
            <p className="mt-3 text-[13px] text-ink-600">
              Для устройств: {bundle.devices.map((d, i) => (
                <span key={d.deviceModel.slug}>{i > 0 && ', '}<Link href={`/device/${d.deviceModel.slug}`} className="text-brand-500 hover:underline">{d.deviceModel.name}</Link></span>
              ))}
            </p>
          )}
          <h2 className="h3 mt-6 mb-3">Состав комплекта</h2>
          <ul className="divide-y divide-ink-200 rounded-[var(--radius-md)] border border-ink-200">
            {bundle.items.map((i) => {
              const pic = i.variant.product.images[0]?.asset;
              return (
                <li key={i.variant.id} className="flex items-center gap-3 p-3">
                  <span className="relative size-14 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-ink-100">{pic && <Image src={(pic.variants as Record<string, string>).thumb ?? pic.publicUrl} alt="" fill sizes="56px" className="object-cover" />}</span>
                  <span className="min-w-0 flex-1">
                    <Link href={`/product/${i.variant.product.slug}`} className="block text-[14px] font-medium hover:text-brand-600">{i.variant.product.name}</Link>
                    <span className="text-[12px] text-ink-500">{i.variant.name !== i.variant.product.name ? i.variant.name : i.variant.product.brand?.name}{i.quantity > 1 ? ` · ${i.quantity} шт.` : ''}</span>
                  </span>
                  <span className="text-[14px] font-semibold">{i.variant.prices[0] ? formatRub(i.variant.prices[0].amountMinor * i.quantity) : '—'}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <aside className="card h-fit p-5 lg:sticky lg:top-32">
          <div className="text-[12px] text-ink-500">Цена комплекта</div>
          <div className="text-[30px] font-bold">{formatRub(p.bundleMinor)}</div>
          <div className="text-[13px] text-ink-500">По отдельности: <s>{formatRub(p.regularMinor)}</s> · выгода <b className="text-success-500">{formatRub(p.savingsMinor)}</b></div>
          <div className="mt-4">
            <AddBundleButton items={bundle.items.map((i) => ({ variantId: i.variant.id, quantity: i.quantity }))} disabled={!p.inStock} />
          </div>
          <p className="mt-3 text-[12px] text-ink-500">Скидка комплекта {bundle.discountPercent}% применяется в корзине к каждой позиции набора.</p>
        </aside>
      </div>
    </div>
  );
}
