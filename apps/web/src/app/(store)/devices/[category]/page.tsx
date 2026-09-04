import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { listDevicesByCategory, NotFoundError } from '@techmatch/domain';
import { DeviceCard } from '@/components/devices/device-card';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { DeviceSearchBox } from '@/components/devices/device-search-box';

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  const c = await prisma.deviceCategory.findUnique({ where: { slug: category } });
  return { title: c ? `${c.name}: подбор аксессуаров` : 'Устройства', description: c?.seoDescription ?? `Выберите модель из категории «${c?.name ?? ''}», чтобы увидеть совместимые аксессуары.` };
}

export default async function DeviceCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  let data: Awaited<ReturnType<typeof listDevicesByCategory>>;
  try {
    data = await listDevicesByCategory(prisma, category);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const brands = Array.from(new Set(data.models.map((m) => m.brand.name)));
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: 'Подбор по устройству', href: '/devices' }, { label: data.category.name }]} />
      <h1 className="h2 mb-2">{data.category.name}</h1>
      <p className="mb-4 max-w-2xl text-[14px] text-ink-600">Выберите свою модель или начните вводить название — покажем только совместимые аксессуары.</p>
      <div className="mb-6 max-w-2xl">
        <DeviceSearchBox placeholder={`Например, ${data.models[0]?.name ?? 'модель'}`} popular={[]} />
      </div>
      {brands.map((brand) => (
        <section key={brand} className="mb-6">
          <h2 className="h3 mb-3">{brand}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.models.filter((m) => m.brand.name === brand).map((m) => (
              <DeviceCard key={m.id} device={m} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
