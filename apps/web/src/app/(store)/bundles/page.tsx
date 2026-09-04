import type { Metadata } from 'next';
import { prisma } from '@techmatch/database';
import { listBundles } from '@techmatch/domain';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { BundleCard } from '@/components/catalog/bundle-card';

export const metadata: Metadata = { title: 'Готовые комплекты', description: 'Наборы аксессуаров для iPhone, MacBook, PlayStation и принтеров — дешевле, чем по отдельности.' };
export const dynamic = 'force-dynamic';

export default async function BundlesPage() {
  const bundles = await listBundles(prisma);
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: 'Готовые комплекты' }]} />
      <h1 className="h2 mb-1">Готовые комплекты</h1>
      <p className="mb-5 max-w-2xl text-[14px] text-ink-600">Всё необходимое для устройства в одном наборе. Каждая позиция проверена на совместимость, а цена ниже, чем при покупке по отдельности.</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {bundles.map((b) => (
          <BundleCard key={b.id} bundle={b} />
        ))}
      </div>
    </div>
  );
}
