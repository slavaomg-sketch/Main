import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@techmatch/database';
import { listProductBrands } from '@techmatch/domain';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

export const metadata: Metadata = { title: 'Бренды' };
export const revalidate = 300;

export default async function BrandsPage() {
  const brands = (await listProductBrands(prisma)).filter((b) => b._count.products > 0);
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: 'Бренды' }]} />
      <h1 className="h2 mb-4">Бренды</h1>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {brands.map((b) => (
          <li key={b.slug}>
            <Link href={`/brand/${b.slug}`} className="card flex min-h-[88px] flex-col items-center justify-center gap-1 p-4 text-center hover:shadow-[var(--shadow-card-hover)]">
              <span className="text-[17px] font-bold">{b.name}</span>
              <span className="text-[12px] text-ink-500">{b._count.products} товаров</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
