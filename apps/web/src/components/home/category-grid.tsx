import Link from 'next/link';
import { Icon } from '@/components/ui/icon';

export function CategoryGrid({ categories }: { categories: Array<{ slug: string; name: string; icon: string }> }) {
  return (
    <section className="shell py-6" aria-label="Категории устройств">
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 md:grid-cols-6 xl:grid-cols-11 xl:gap-2.5">
        {categories.map((c) => (
          <li key={c.slug} className="w-[104px] shrink-0 snap-start sm:w-auto">
            <Link href={`/devices/${c.slug}`} className="card flex h-full min-h-[88px] flex-col items-center justify-center gap-2 px-2 py-3 text-center transition-[box-shadow,border-color] hover:border-brand-200 hover:shadow-[var(--shadow-card-hover)]">
              <span className="inline-flex size-10 items-center justify-center rounded-[var(--radius-sm)] bg-brand-50 text-brand-500">
                <Icon name={c.icon} width={22} height={22} strokeWidth={1.7} />
              </span>
              <span className="text-[11px] leading-[1.2] font-medium text-ink-800">{c.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
