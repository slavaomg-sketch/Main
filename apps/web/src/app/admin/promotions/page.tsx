import Link from 'next/link';
import { prisma } from '@techmatch/database';
import { requireAdmin } from '@/lib/admin';
import { AdminPage } from '@/components/admin/ui';
import { BundlesEditor, CouponsEditor, PromotionsEditor } from '@/components/admin/promo-forms';

export default async function AdminPromotions({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAdmin('promotions.read');
  const { tab = 'coupons' } = await searchParams;
  const [coupons, promotions, bundles, categories, brands] = await Promise.all([
    prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.promotion.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.bundle.findMany({ orderBy: { sortOrder: 'asc' }, include: { items: { orderBy: { sortOrder: 'asc' }, include: { variant: { select: { sku: true } } } }, devices: { include: { deviceModel: { select: { slug: true } } } } } }),
    prisma.accessoryCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.productBrand.findMany({ orderBy: { name: 'asc' } }),
  ]);
  const tabs = [['coupons', 'Промокоды'], ['promotions', 'Акции'], ['bundles', 'Комплекты']];
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return (
    <AdminPage title="Маркетинг" description="Промокоды, скидки, комплекты, акции. Рекомендации на витрине строятся из совместимости и подборок.">
      <div className="mb-4 flex flex-wrap gap-2">{tabs.map(([t, l]) => <Link key={t} href={`/admin/promotions?tab=${t}`} className={`chip ${tab === t ? 'bg-ink-900 text-white hover:bg-ink-800' : ''}`}>{l}</Link>)}</div>
      {tab === 'coupons' && <CouponsEditor coupons={coupons.map((c) => ({ ...c, startsAt: iso(c.startsAt), endsAt: iso(c.endsAt) }))} promotions={promotions.map((p) => ({ id: p.id, name: p.name }))} />}
      {tab === 'promotions' && <PromotionsEditor promotions={promotions.map((p) => ({ ...p, startsAt: iso(p.startsAt), endsAt: iso(p.endsAt) }))} categories={categories} brands={brands} />}
      {tab === 'bundles' && <BundlesEditor bundles={bundles.map((b) => ({ id: b.id, name: b.name, slug: b.slug, description: b.description, discountPercent: b.discountPercent, isActive: b.isActive, sortOrder: b.sortOrder, items: b.items.map((i) => `${i.variant.sku} × ${i.quantity}`), devices: b.devices.map((d) => d.deviceModel.slug) }))} />}
    </AdminPage>
  );
}
