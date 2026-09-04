'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';

export interface FilterFacets {
  brands: Array<{ slug: string; name: string; count: number }>;
  categories: Array<{ slug: string; name: string; count: number }>;
  priceMinMinor: number;
  priceMaxMinor: number;
}

/** Фильтры каталога: на desktop — боковая колонка, на mobile/tablet — drawer. Состояние в URL. */
export function CatalogFilters({ facets, showCategories = true, activeDevice }: { facets: FilterFacets; showCategories?: boolean; activeDevice?: { name: string } | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [min, setMin] = useState(sp.get('min') ?? '');
  const [max, setMax] = useState(sp.get('max') ?? '');
  useEffect(() => {
    setMin(sp.get('min') ?? '');
    setMax(sp.get('max') ?? '');
  }, [sp]);
  const brands = new Set(sp.getAll('brand'));
  const apply = (mutate: (q: URLSearchParams) => void) => {
    const q = new URLSearchParams(sp.toString());
    mutate(q);
    q.delete('page');
    router.push(`${pathname}?${q.toString()}`);
  };
  const activeCount = brands.size + (sp.get('min') || sp.get('max') ? 1 : 0) + (sp.get('stock') ? 1 : 0) + (sp.get('sale') ? 1 : 0) + (sp.get('compat') ? 1 : 0);
  const body = (
    <div className="space-y-6">
      {activeDevice && (
        <fieldset>
          <legend className="mb-2 text-[13px] font-bold">Моё устройство</legend>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="size-4 accent-brand-500" checked={sp.get('compat') === '1'} onChange={(e) => apply((q) => (e.target.checked ? q.set('compat', '1') : q.delete('compat')))} />
            Только для {activeDevice.name}
          </label>
        </fieldset>
      )}
      <fieldset>
        <legend className="mb-2 text-[13px] font-bold">Цена, ₽</legend>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply((q) => {
              if (min) q.set('min', min);
              else q.delete('min');
              if (max) q.set('max', max);
              else q.delete('max');
            });
          }}
        >
          <input inputMode="numeric" className="input min-h-9 px-2.5 text-[13px]" placeholder={String(Math.floor(facets.priceMinMinor / 100))} value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} aria-label="Цена от" />
          <span className="text-ink-400">—</span>
          <input inputMode="numeric" className="input min-h-9 px-2.5 text-[13px]" placeholder={String(Math.ceil(facets.priceMaxMinor / 100))} value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} aria-label="Цена до" />
          <button type="submit" className="btn btn-outline btn-sm min-h-9 px-3">ОК</button>
        </form>
      </fieldset>
      {facets.brands.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-[13px] font-bold">Бренд</legend>
          <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {facets.brands.map((b) => (
              <li key={b.slug}>
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" className="size-4 accent-brand-500" checked={brands.has(b.slug)} onChange={(e) => apply((q) => { q.delete('brand'); const next = new Set(brands); if (e.target.checked) next.add(b.slug); else next.delete(b.slug); next.forEach((v) => q.append('brand', v)); })} />
                  <span className="flex-1">{b.name}</span>
                  <span className="text-ink-400">{b.count}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {showCategories && facets.categories.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-[13px] font-bold">Категория</legend>
          <ul className="space-y-1.5">
            {facets.categories.map((c) => (
              <li key={c.slug}>
                <a href={`/category/${c.slug}`} className="flex items-center justify-between text-[13px] hover:text-brand-600">
                  <span>{c.name}</span>
                  <span className="text-ink-400">{c.count}</span>
                </a>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <fieldset className="space-y-1.5">
        <legend className="mb-2 text-[13px] font-bold">Наличие и акции</legend>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="size-4 accent-brand-500" checked={sp.get('stock') === '1'} onChange={(e) => apply((q) => (e.target.checked ? q.set('stock', '1') : q.delete('stock')))} /> Только в наличии
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="size-4 accent-brand-500" checked={sp.get('sale') === '1'} onChange={(e) => apply((q) => (e.target.checked ? q.set('sale', '1') : q.delete('sale')))} /> Со скидкой
        </label>
      </fieldset>
      {activeCount > 0 && (
        <button type="button" className="btn btn-ghost btn-sm w-full" onClick={() => apply((q) => ['brand', 'min', 'max', 'stock', 'sale', 'compat'].forEach((k) => q.delete(k)))}>
          Сбросить фильтры
        </button>
      )}
    </div>
  );
  return (
    <>
      <button type="button" className="btn btn-outline btn-sm lg:hidden" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <SlidersHorizontal width={15} height={15} /> Фильтры{activeCount > 0 ? ` (${activeCount})` : ''}
      </button>
      <aside className="hidden w-60 shrink-0 lg:block" aria-label="Фильтры">{body}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Фильтры">
          <div className="absolute inset-0 bg-ink-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-[var(--radius-xl)] bg-surface p-5 pb-8 sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-80 sm:rounded-none">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[16px] font-bold">Фильтры</span>
              <button type="button" className="icon-btn -mr-2" aria-label="Закрыть" onClick={() => setOpen(false)}><X width={20} height={20} /></button>
            </div>
            {body}
            <button type="button" className="btn btn-primary mt-6 w-full" onClick={() => setOpen(false)}>Показать товары</button>
          </div>
        </div>
      )}
    </>
  );
}
