'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';

export interface SuggestData {
  devices: Array<{ slug: string; name: string; fullName: string; imageUrl: string | null; category: { name: string }; variants: Array<{ id: string; name: string }> }>;
  products: Array<{ slug: string; name: string; image: { url: string; variants: Record<string, string> } | null; priceMinor: number }>;
  resolution: 'exact' | 'ambiguous' | 'none';
  hint: string | null;
}

export function useSuggest(q: string, enabled: boolean) {
  const [data, setData] = useState<SuggestData | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const query = q.trim();
    if (!enabled || query.length < 2) {
      setData(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        if (res.ok) setData((await res.json()) as SuggestData);
      } catch {
        /* отменено */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, enabled]);
  return { data, loading };
}

const fmt = (minor: number) => `${Math.round(minor / 100).toLocaleString('ru-RU')} ₽`;

export function SuggestList({ id, data, loading, query, onPick }: { id: string; data: SuggestData | null; loading: boolean; query: string; onPick: () => void }) {
  return (
    <div id={id} role="listbox" className="absolute inset-x-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-[var(--radius-lg)] border border-ink-200 bg-surface shadow-[var(--shadow-pop)]">
      {loading && !data && (
        <div className="flex items-center gap-2 px-4 py-3 text-[13px] text-ink-500">
          <Loader2 width={16} height={16} className="animate-spin" /> Ищем…
        </div>
      )}
      {data && data.devices.length === 0 && data.products.length === 0 && (
        <div className="px-4 py-3 text-[13px] text-ink-500">Ничего не нашли по запросу «{query}». Попробуйте указать бренд и модель, например «iPhone 15 Pro».</div>
      )}
      {data && data.devices.length > 0 && (
        <div className="p-2">
          <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
            Устройства {data.hint && data.resolution === 'ambiguous' && <span className="ml-1 font-normal normal-case tracking-normal text-warning-500">— {data.hint}</span>}
          </div>
          {data.devices.map((d) => (
            <Link key={d.slug} href={`/device/${d.slug}`} onClick={onPick} role="option" aria-selected={false} className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-ink-100">
              <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-ink-100 bg-white">
                {d.imageUrl ? <img src={d.imageUrl} alt="" width={40} height={40} className="size-full object-contain" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{d.fullName}</span>
                <span className="block text-[12px] text-ink-500">{d.category.name}{d.variants.length > 1 ? ` · ${d.variants.length} модификации` : ''}</span>
              </span>
              <ArrowRight width={14} height={14} className="text-ink-400" />
            </Link>
          ))}
        </div>
      )}
      {data && data.products.length > 0 && (
        <div className="border-t border-ink-200 p-2">
          <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">Товары</div>
          {data.products.map((p) => (
            <Link key={p.slug} href={`/product/${p.slug}`} onClick={onPick} role="option" aria-selected={false} className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-ink-100">
              <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-ink-100 bg-white">
                {p.image ? <img src={p.image.variants.thumb ?? p.image.url} alt="" width={40} height={40} className="size-full object-contain" /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{p.name}</span>
              <span className="text-[13px] font-semibold">{fmt(p.priceMinor)}</span>
            </Link>
          ))}
          <Link href={`/search?q=${encodeURIComponent(query)}`} onClick={onPick} className="mt-1 flex items-center gap-1 px-2 py-1.5 text-[13px] font-medium text-brand-500 hover:underline">
            Все результаты <ArrowRight width={14} height={14} />
          </Link>
        </div>
      )}
    </div>
  );
}
