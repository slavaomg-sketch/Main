'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Menu, X, ChevronRight } from 'lucide-react';
import { Icon } from '@/components/ui/icon';

export function MobileMenu({ nav, categories, deviceCategories, activeDevice }: { nav: Array<{ href: string; label: string }>; categories: Array<{ slug: string; name: string; icon: string | null }>; deviceCategories: Array<{ slug: string; name: string; icon: string }>; activeDevice: { slug: string; name: string } | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);
  return (
    <>
      <button type="button" className="icon-btn -ml-2 md:hidden" aria-label="Меню" aria-expanded={open} onClick={() => setOpen(true)}>
        <Menu width={24} height={24} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Меню">
          <div className="absolute inset-0 bg-ink-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(88vw,360px)] flex-col overflow-y-auto bg-surface shadow-[var(--shadow-pop)]">
            <div className="flex h-14 items-center justify-between border-b border-ink-200 px-4">
              <span className="text-[17px] font-bold">Меню</span>
              <button type="button" className="icon-btn -mr-2" aria-label="Закрыть" onClick={() => setOpen(false)}>
                <X width={22} height={22} />
              </button>
            </div>
            {activeDevice && (
              <Link href={`/device/${activeDevice.slug}`} onClick={() => setOpen(false)} className="m-4 flex items-center justify-between rounded-[var(--radius-md)] bg-tint-blue px-4 py-3 text-[13px]">
                <span>
                  <span className="block text-ink-500">Моё устройство</span>
                  <span className="font-semibold">{activeDevice.name}</span>
                </span>
                <ChevronRight width={16} height={16} />
              </Link>
            )}
            <nav className="px-2 py-2">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="flex min-h-11 items-center px-3 text-[15px] font-medium hover:bg-ink-100">
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="border-t border-ink-200 px-2 py-2">
              <div className="px-3 py-2 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">Устройства</div>
              {deviceCategories.map((c) => (
                <Link key={c.slug} href={`/devices/${c.slug}`} onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-3 px-3 text-[14px] hover:bg-ink-100">
                  <Icon name={c.icon} width={18} height={18} className="text-brand-500" /> {c.name}
                </Link>
              ))}
            </div>
            <div className="border-t border-ink-200 px-2 py-2">
              <div className="px-3 py-2 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">Аксессуары</div>
              {categories.map((c) => (
                <Link key={c.slug} href={`/category/${c.slug}`} onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-3 px-3 text-[14px] hover:bg-ink-100">
                  <Icon name={c.icon ?? 'layout-grid'} width={18} height={18} className="text-brand-500" /> {c.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
