import Link from 'next/link';
import { prisma } from '@techmatch/database';
import { getHomepageSettings } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { AdminPage } from '@/components/admin/ui';
import { BannersEditor, BrandsEditor, CollectionsEditor, FaqEditor, HomepageForm, PagesEditor } from '@/components/admin/content-forms';

export default async function AdminContent({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAdmin('content.read');
  const { tab = 'home' } = await searchParams;
  const [settings, banners, collections, pages, faq, brands] = await Promise.all([
    getHomepageSettings(prisma),
    prisma.banner.findMany({ orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }], include: { imageAsset: true } }),
    prisma.collection.findMany({ orderBy: { sortOrder: 'asc' }, include: { items: { orderBy: { sortOrder: 'asc' }, include: { product: { select: { slug: true } } } } } }),
    prisma.contentPage.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.faqItem.findMany({ orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] }),
    prisma.productBrand.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);
  const tabs = [['home', 'Главная и hero'], ['banners', 'Баннеры'], ['collections', 'Подборки'], ['brands', 'Бренды'], ['pages', 'Страницы'], ['faq', 'FAQ']];
  return (
    <AdminPage title="Контент" description="Главная страница, hero, баннеры, подборки, популярные товары, бренды, FAQ, информационные страницы">
      <div className="mb-4 flex flex-wrap gap-2">{tabs.map(([t, l]) => <Link key={t} href={`/admin/content?tab=${t}`} className={`chip ${tab === t ? 'bg-ink-900 text-white hover:bg-ink-800' : ''}`}>{l}</Link>)}</div>
      {tab === 'home' && <HomepageForm s={settings} collections={collections.map((c) => ({ slug: c.slug, name: c.name }))} />}
      {tab === 'banners' && <BannersEditor banners={banners.map((b) => ({ id: b.id, placement: b.placement, theme: b.theme, title: b.title, subtitle: b.subtitle, ctaLabel: b.ctaLabel, ctaUrl: b.ctaUrl, handwrittenNote: b.handwrittenNote, sortOrder: b.sortOrder, isActive: b.isActive, imageUrl: b.imageAsset ? ((b.imageAsset.variants as Record<string, string>).thumb ?? b.imageAsset.publicUrl) : b.imageUrl }))} />}
      {tab === 'collections' && <CollectionsEditor collections={collections.map((c) => ({ slug: c.slug, name: c.name, isActive: c.isActive, items: c.items.map((i) => i.product.slug) }))} />}
      {tab === 'brands' && <BrandsEditor brands={brands} />}
      {tab === 'pages' && <PagesEditor pages={pages} />}
      {tab === 'faq' && <FaqEditor items={faq} />}
    </AdminPage>
  );
}
