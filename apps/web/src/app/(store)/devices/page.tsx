import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SearchX } from 'lucide-react';
import { prisma } from '@techmatch/database';
import { listDeviceCategories, listPopularDevices, searchDevices } from '@techmatch/domain';
import { DeviceSearchBox } from '@/components/devices/device-search-box';
import { DeviceCard } from '@/components/devices/device-card';
import { Icon } from '@/components/ui/icon';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { EmptyState } from '@/components/ui/empty';
import { SectionTitle } from '@/components/ui/section-title';

export const metadata: Metadata = { title: 'Подбор аксессуаров по устройству', description: 'Введите модель устройства — покажем только совместимые аксессуары и объясним, почему они подходят.' };
export const dynamic = 'force-dynamic';

export default async function DevicesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const [categories, popular] = await Promise.all([listDeviceCategories(prisma), listPopularDevices(prisma, 8)]);
  const result = q && q.trim().length >= 2 ? await searchDevices(prisma, q, { limit: 12, log: true }) : null;
  // Однозначный запрос — сразу на страницу устройства
  if (result?.resolution === 'exact' && result.best) redirect(`/device/${result.best.slug}`);
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: 'Подбор по устройству' }]} />
      <section className="rounded-[var(--radius-xl)] bg-hero px-5 py-7 sm:px-8 sm:py-9">
        <h1 className="h2 mb-1.5 sm:text-[28px]">Какое у вас устройство?</h1>
        <p className="mb-5 max-w-xl text-[14px] text-ink-600">Введите бренд и модель — например, «iPhone 15 Pro», «MacBook Air M2» или «Canon G3410». Мы покажем только те аксессуары, которые точно подходят.</p>
        <div className="max-w-2xl">
          <DeviceSearchBox placeholder="Введите тип устройства или модель..." popular={['iPhone 15 Pro', 'MacBook Air', 'Galaxy S25', 'PlayStation 5', 'Canon G3410']} autoFocus={Boolean(q)} />
        </div>
      </section>

      {result && (
        <section className="mt-6" aria-live="polite" data-testid="device-results">
          <h2 className="h3 mb-3">
            {result.candidates.length > 0 ? `Найдено по запросу «${result.query}»` : `По запросу «${result.query}» ничего не найдено`}
          </h2>
          {result.resolution === 'ambiguous' && result.disambiguationHint && (
            <p className="mb-3 rounded-[var(--radius-md)] bg-warning-100 px-4 py-2.5 text-[13px] text-warning-500" data-testid="device-ambiguous">{result.disambiguationHint}</p>
          )}
          {result.candidates.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {result.candidates.map((c) => (
                <DeviceCard key={c.id} device={c} />
              ))}
            </div>
          ) : (
            <EmptyState icon={<SearchX width={26} height={26} />} title="Не нашли такое устройство" text="Проверьте написание или попробуйте указать номер модели (например, A2681). Мы записали запрос и добавим устройство в базу." action={<Link href="/catalog" className="btn btn-outline">Открыть весь каталог</Link>} />
          )}
        </section>
      )}

      <section className="mt-8">
        <SectionTitle title="Выберите тип устройства" />
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((c) => (
            <li key={c.slug}>
              <Link href={`/devices/${c.slug}`} className="card flex items-center gap-3 p-3.5 hover:shadow-[var(--shadow-card-hover)]">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-brand-50 text-brand-500"><Icon name={c.icon} width={20} height={20} /></span>
                <span>
                  <span className="block text-[13px] font-semibold">{c.name}</span>
                  <span className="block text-[12px] text-ink-500">{c._count.models} моделей</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-8">
        <SectionTitle title="Популярные устройства" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {popular.map((d) => (
            <DeviceCard key={d.id} device={d} />
          ))}
        </div>
      </section>
    </div>
  );
}
