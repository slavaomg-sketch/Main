'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { SuggestList, useSuggest } from '@/components/devices/suggest';

/** Главная строка подбора устройства в hero. */
export function DeviceSearchBox({ placeholder, popular, autoFocus = false }: { placeholder: string; popular: string[]; autoFocus?: boolean }) {
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
  const go = () => {
    const query = q.trim();
    if (!query) return;
    setOpen(false);
    if (data?.resolution === 'exact' && data.devices[0]) router.push(`/device/${data.devices[0].slug}`);
    else router.push(`/devices?q=${encodeURIComponent(query)}`);
  };
  return (
    <div ref={box} className="relative">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        className="flex h-14 items-center gap-2 rounded-[var(--radius-pill)] bg-surface p-1.5 pl-4 shadow-[0_8px_30px_rgba(15,23,42,0.08)] ring-1 ring-ink-200 focus-within:ring-brand-500 sm:h-16 sm:pl-5"
      >
        <Search width={20} height={20} className="shrink-0 text-ink-700" aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink-900 outline-none placeholder:text-ink-500 sm:text-[15px]"
          aria-label="Введите тип устройства или модель"
          aria-controls={`${id}-list`}
          autoComplete="off"
          autoFocus={autoFocus}
          enterKeyHint="search"
          data-testid="device-search-input"
        />
        <button type="submit" className="btn btn-primary h-full min-h-0 px-6 sm:px-8" data-testid="device-search-submit">
          Найти
        </button>
      </form>
      {open && q.trim().length >= 2 && <SuggestList id={`${id}-list`} data={data} loading={loading} query={q} onPick={() => setOpen(false)} />}
      {popular.length > 0 && (
        <div className="mt-3.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-500">
          <span className="mr-0.5">Популярные запросы:</span>
          {popular.map((p) => (
            <Link key={p} href={`/devices?q=${encodeURIComponent(p)}`} className="chip min-h-7 px-3 text-[12px]">
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
