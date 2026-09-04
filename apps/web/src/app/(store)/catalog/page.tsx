import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@techmatch/database';
import { getCollectionWithProducts, listAccessoryCategories } from '@techmatch/domain';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { CatalogView, type CatalogSearchParams } from '@/components/catalog/catalog-view';
import { Icon } from '@/components/ui/icon';

export const metadata: Metadata = { title: 'Каталог аксессуаров', description: 'Зарядки, кабели, чехлы, картриджи, игровые и автомобильные аксессуары с проверкой совместимости.' };
export const dynamic = 'force-dynamic';

export default async function CatalogPage({ searchParams }: { searchParams: Promise<CatalogSearchParams> }) {
  const sp = await searchParams;
  const collectionSlug = typeof sp.collection === 'string' ? sp.collection : null;
  const collection = collectionSlug ? await getCollectionWithProducts(prisma, collectionSlug, 200) : null;
  const categories = await listAccessoryCategories(prisma);
  const title = collection ? collection.collection.name : sp.new === '1' ? 'Новинки' : sp.sale === '1' ? 'Акции и скидки' : 'Каталог аксессуаров';
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: title }]} />
      <h1 className="h2 mb-4">{title}</h1>
      {!collection && !sp.new && !sp.sale && (
        <ul className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
          {categories.filter((c) => !c.parentId && c._count.products > 0).map((c) => (
            <li key={c.slug} className="shrink-0">
              <Link href={`/category/${c.slug}`} className="chip gap-1.5">
                <Icon name={c.icon ?? 'layout-grid'} width={14} height={14} className="text-brand-500" /> {c.name} <span className="text-ink-400">{c._count.products}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CatalogView sp={sp} basePath="/catalog" fixed={collection ? { productIds: collection.productIds } : {}} />
    </div>
  );
}
