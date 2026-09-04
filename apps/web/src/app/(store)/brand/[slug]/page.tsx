import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { getProductBrand, NotFoundError } from '@techmatch/domain';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { CatalogView, type CatalogSearchParams } from '@/components/catalog/catalog-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const b = await prisma.productBrand.findUnique({ where: { slug } });
  return { title: b ? `${b.name}: аксессуары` : 'Бренд', description: b?.description ?? undefined, alternates: { canonical: `/brand/${slug}` } };
}

export default async function BrandPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<CatalogSearchParams> }) {
  const { slug } = await params;
  const sp = await searchParams;
  let brand: Awaited<ReturnType<typeof getProductBrand>>;
  try {
    brand = await getProductBrand(prisma, slug);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: 'Бренды', href: '/brands' }, { label: brand.name }]} />
      <h1 className="h2 mb-1">{brand.name}</h1>
      {brand.description && <p className="mb-4 max-w-2xl text-[14px] text-ink-600">{brand.description}</p>}
      <CatalogView sp={sp} basePath={`/brand/${slug}`} fixed={{ brandSlugs: [slug] }} />
    </div>
  );
}
