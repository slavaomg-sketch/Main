'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const OPTIONS: Array<[string, string]> = [['popular', 'По популярности'], ['compat', 'Сначала совместимые'], ['price_asc', 'Сначала дешевле'], ['price_desc', 'Сначала дороже'], ['rating', 'По рейтингу'], ['new', 'Новинки']];

export function SortSelect({ value, allowCompat = false }: { value: string; allowCompat?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <label className="inline-flex items-center gap-2 text-[13px] text-ink-600">
      <span className="hidden sm:inline">Сортировка:</span>
      <select
        aria-label="Сортировка"
        className="input min-h-9 w-auto py-0 pr-8 text-[13px]"
        value={value}
        onChange={(e) => {
          const q = new URLSearchParams(sp.toString());
          q.set('sort', e.target.value);
          q.delete('page');
          router.push(`${pathname}?${q.toString()}`);
        }}
      >
        {OPTIONS.filter(([v]) => allowCompat || v !== 'compat').map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}
