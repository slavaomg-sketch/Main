import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { getContentPage, listContentPages, NotFoundError } from '@techmatch/domain';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { renderMarkdown } from '@/lib/markdown';
import Link from 'next/link';

export const revalidate = 300;

export async function generateStaticParams() {
  return (await listContentPages(prisma)).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await prisma.contentPage.findUnique({ where: { slug } });
  return { title: p?.seoTitle ?? p?.title ?? 'Страница', description: p?.seoDescription ?? undefined, alternates: { canonical: `/info/${slug}` } };
}

export default async function InfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let page: Awaited<ReturnType<typeof getContentPage>>;
  try {
    page = await getContentPage(prisma, slug);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const pages = await listContentPages(prisma);
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: page.title }]} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="card h-fit p-2" aria-label="Информация">
          {pages.map((p) => (
            <Link key={p.slug} href={`/info/${p.slug}`} className={`block rounded-[var(--radius-sm)] px-3 py-2 text-[13.5px] ${p.slug === slug ? 'bg-brand-50 font-semibold text-brand-600' : 'hover:bg-ink-100'}`}>{p.title}</Link>
          ))}
        </nav>
        <article className="card p-6">
          <h1 className="h2 mb-2">{page.title}</h1>
          {renderMarkdown(page.body)}
        </article>
      </div>
    </div>
  );
}
