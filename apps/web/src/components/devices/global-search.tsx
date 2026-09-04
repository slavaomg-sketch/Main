'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { SuggestList, useSuggest } from '@/components/devices/suggest';

/**
 * Глобальная строка поиска в шапке: подсказки по устройствам и товарам,
 * Enter → /search?q=..., выбор устройства → /device/[slug].
 */
export function GlobalSearch({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const { data, loading } = useSuggest(q, open);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const submit = () => {
    const query = q.trim();
    if (!query) return;
    setOpen(false);
    if (data?.resolution === 'exact' && data.devices[0]) router.push(`/device/${data.devices[0].slug}`);
    else router.push(`/search?q=${encodeURIComponent(query)}`);
  };
  return (
    <div ref={box} className="relative">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={`flex items-center gap-2 rounded-[var(--radius-pill)] border border-ink-300 bg-surface pr-2 pl-3.5 focus-within:border-brand-500 focus-within:shadow-[var(--shadow-focus)] ${compact ? 'h-11' : 'h-11'}`}
      >
        <Search width={18} height={18} className="shrink-0 text-ink-500" aria-hidden="true" />
        <input
          id={id}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={compact ? 'Устройство, модель или товар' : 'Введите тип устройства или модель (например, iPhone, Samsung, MacBook, принтер...)'}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink-900 outline-none placeholder:text-ink-400"
          aria-label="Поиск устройства или товара"
          aria-autocomplete="list"
          aria-expanded={open && Boolean(data)}
          aria-controls={`${id}-list`}
          autoComplete="off"
          enterKeyHint="search"
        />
        <button type="submit" className="hidden rounded-[var(--radius-pill)] px-3 py-1 text-[12px] font-semibold text-brand-500 hover:bg-brand-50 sm:inline-flex">
          Найти
        </button>
      </form>
      {open && q.trim().length >= 2 && (
        <SuggestList id={`${id}-list`} data={data} loading={loading} query={q} onPick={() => setOpen(false)} />
      )}
    </div>
  );
}
