import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { getAccessoryCategory, NotFoundError } from '@techmatch/domain';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { CatalogView, type CatalogSearchParams } from '@/components/catalog/catalog-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await prisma.accessoryCategory.findUnique({ where: { slug } });
  return { title: c?.seoTitle ?? c?.name ?? 'Категория', description: c?.seoDescription ?? c?.description ?? undefined, alternates: { canonical: `/category/${slug}` } };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<CatalogSearchParams> }) {
  const { slug } = await params;
  const sp = await searchParams;
  let cat: Awaited<ReturnType<typeof getAccessoryCategory>>;
  try {
    cat = await getAccessoryCategory(prisma, slug);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: 'Каталог', href: '/catalog' }, ...(cat.parent ? [{ label: cat.parent.name, href: `/category/${cat.parent.slug}` }] : []), { label: cat.name }]} />
      <h1 className="h2 mb-1">{cat.name}</h1>
      {cat.description && <p className="mb-4 max-w-2xl text-[14px] text-ink-600">{cat.description}</p>}
      {cat.children.length > 0 && (
        <ul className="mb-5 flex flex-wrap gap-2">
          {cat.children.map((c) => (
            <li key={c.slug}><Link href={`/category/${c.slug}`} className="chip">{c.name}</Link></li>
          ))}
        </ul>
      )}
      <CatalogView sp={sp} basePath={`/category/${slug}`} fixed={{ categorySlug: slug }} showCategories={false} />
    </div>
  );
}
