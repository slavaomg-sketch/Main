import { prisma } from '@techmatch/database';
import { getCollectionWithProducts, getHomepageSettings, getProductCardsByIds, getSetting, listBanners, listDeviceCategories, listProductBrands } from '@techmatch/domain';
import { Hero, type HeroImage } from '@/components/home/hero';
import { CategoryGrid } from '@/components/home/category-grid';
import { Advantages } from '@/components/home/advantages';
import { PromoCards } from '@/components/home/promo-cards';
import { WideBanners } from '@/components/home/wide-banners';
import { BrandsRow } from '@/components/home/brands-row';
import { Newsletter } from '@/components/home/newsletter';
import { ProductGrid } from '@/components/catalog/product-grid';
import { SectionTitle } from '@/components/ui/section-title';
import { getActiveDeviceId, getCustomer } from '@/lib/session';
import { getGuestFavoriteIds } from '@/lib/favorites';

export const revalidate = 60;

export default async function HomePage() {
  const [settings, heroImages, deviceCategories, banners, brands, activeDeviceId, customer] = await Promise.all([
    getHomepageSettings(prisma),
    getSetting<HeroImage[]>(prisma, 'hero_images', []),
    listDeviceCategories(prisma),
    listBanners(prisma),
    listProductBrands(prisma, { popularOnly: true }),
    getActiveDeviceId(),
    getCustomer(),
  ]);
  const featured = await getCollectionWithProducts(prisma, settings.featuredCollectionSlug, 6);
  const products = featured ? await getProductCardsByIds(prisma, featured.productIds, activeDeviceId) : [];
  const favorites = customer ? (await prisma.favorite.findMany({ where: { customerId: customer.customer.id }, select: { productId: true } })).map((f) => f.productId) : await getGuestFavoriteIds();
  const promo = banners.filter((b) => b.placement === 'HOME_PROMO').map((b) => ({ id: b.id, title: b.title, subtitle: b.subtitle, ctaLabel: b.ctaLabel, ctaUrl: b.ctaUrl, theme: b.theme, imageUrl: b.imageAsset ? ((b.imageAsset.variants as Record<string, string>).card ?? b.imageAsset.publicUrl) : b.imageUrl }));
  const wide = banners.filter((b) => b.placement === 'HOME_WIDE').map((b) => ({ id: b.id, title: b.title, subtitle: b.subtitle, ctaLabel: b.ctaLabel, ctaUrl: b.ctaUrl, theme: b.theme, imageUrl: b.imageAsset ? ((b.imageAsset.variants as Record<string, string>).large ?? b.imageAsset.publicUrl) : b.imageUrl, handwrittenNote: b.handwrittenNote }));

  return (
    <>
      <Hero settings={settings} images={Array.isArray(heroImages) ? heroImages : []} />
      <CategoryGrid categories={deviceCategories.map((c) => ({ slug: c.slug, name: c.name, icon: c.icon }))} />
      <Advantages items={settings.advantages} />
      <PromoCards cards={promo} />
      <section className="shell py-5" aria-labelledby="popular-title">
        <SectionTitle title={featured?.collection.name ?? 'Популярные товары'} href={`/catalog?collection=${settings.featuredCollectionSlug}`} />
        <ProductGrid products={products} favorites={favorites} deviceModelId={activeDeviceId} priorityCount={6} />
      </section>
      <WideBanners banners={wide} />
      <BrandsRow brands={brands.map((b) => ({ slug: b.slug, name: b.name }))} />
      <Newsletter title={settings.newsletterTitle} text={settings.newsletterText} />
    </>
  );
}
