'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/icon';

export function CatalogMenu({ children, categories, deviceCategories }: { children: ReactNode; categories: Array<{ slug: string; name: string; icon: string | null }>; deviceCategories: Array<{ slug: string; name: string; icon: string }> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setOpen(false)}>
      <button type="button" className="cursor-pointer" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)} onMouseEnter={() => setOpen(true)}>
        {children}
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 w-[720px] rounded-b-[var(--radius-lg)] border border-ink-200 bg-surface p-5 shadow-[var(--shadow-pop)]" role="menu">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="mb-2 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">Аксессуары</div>
              <ul className="grid grid-cols-2 gap-0.5">
                {categories.map((c) => (
                  <li key={c.slug}>
                    <Link href={`/category/${c.slug}`} className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px] hover:bg-ink-100" role="menuitem" onClick={() => setOpen(false)}>
                      <Icon name={c.icon ?? 'layout-grid'} width={16} height={16} className="text-brand-500" />
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-2 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">Подбор по устройству</div>
              <ul className="grid grid-cols-2 gap-0.5">
                {deviceCategories.map((c) => (
                  <li key={c.slug}>
                    <Link href={`/devices/${c.slug}`} className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px] hover:bg-ink-100" role="menuitem" onClick={() => setOpen(false)}>
                      <Icon name={c.icon} width={16} height={16} className="text-brand-500" />
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href="/catalog" className="mt-3 inline-flex text-[13px] font-medium text-brand-500 hover:underline" onClick={() => setOpen(false)}>
                Весь каталог →
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
