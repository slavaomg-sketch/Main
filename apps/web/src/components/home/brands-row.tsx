import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

const STYLE: Record<string, string> = {
  anker: 'font-extrabold tracking-[0.12em] uppercase',
  ugreen: 'font-extrabold tracking-[0.04em] uppercase',
  baseus: 'font-bold tracking-[-0.01em]',
  belkin: 'font-bold lowercase tracking-[-0.03em]',
  samsung: 'font-extrabold tracking-[0.1em] uppercase',
  apple: 'font-semibold',
  xiaomi: 'rounded-[6px] bg-[#ff6900] px-1.5 py-0.5 text-[13px] font-bold text-white',
  canon: 'font-black italic tracking-[-0.02em]',
  hp: 'inline-flex size-7 items-center justify-center rounded-full border-2 border-ink-700 text-[11px] font-bold lowercase',
  sony: 'font-black tracking-[0.06em] uppercase',
};

export function BrandsRow({ brands }: { brands: Array<{ slug: string; name: string }> }) {
  return (
    <section className="shell py-5" aria-label="Популярные бренды">
      <div className="flex items-center gap-6 overflow-x-auto scrollbar-none">
        <span className="shrink-0 text-[13px] font-semibold text-ink-900">Популярные бренды</span>
        <ul className="flex flex-1 items-center gap-7 md:gap-9">
          {brands.map((b) => (
            <li key={b.slug} className="shrink-0">
              <Link href={`/brand/${b.slug}`} className={`text-[15px] text-ink-700 transition-colors hover:text-ink-900 ${STYLE[b.slug] ?? 'font-semibold'}`} aria-label={b.name}>
                {b.slug === 'xiaomi' ? 'mi' : b.slug === 'hp' ? 'hp' : b.name}
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/brands" className="ml-auto inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-brand-500 hover:text-brand-700">
          Все бренды <ArrowRight width={14} height={14} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
