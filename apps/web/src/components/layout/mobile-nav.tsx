'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, Home, LayoutGrid, ShoppingCart, Smartphone } from 'lucide-react';

const ITEMS = [
  { href: '/', label: 'Главная', Icon: Home, match: (p: string) => p === '/' },
  { href: '/catalog', label: 'Каталог', Icon: LayoutGrid, match: (p: string) => p.startsWith('/catalog') || p.startsWith('/category') || p.startsWith('/product') },
  { href: '/devices', label: 'Устройства', Icon: Smartphone, match: (p: string) => p.startsWith('/device') },
  { href: '/favorites', label: 'Избранное', Icon: Heart, match: (p: string) => p.startsWith('/favorites') },
  { href: '/cart', label: 'Корзина', Icon: ShoppingCart, match: (p: string) => p.startsWith('/cart') || p.startsWith('/checkout') },
];

export function MobileNav({ cartCount }: { cartCount: number }) {
  const pathname = usePathname() ?? '/';
  if (pathname.startsWith('/admin')) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-surface/95 backdrop-blur md:hidden" aria-label="Мобильная навигация" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className="grid grid-cols-5">
        {ITEMS.map((it) => {
          const active = it.match(pathname);
          return (
            <li key={it.href}>
              <Link href={it.href} className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${active ? 'text-brand-500' : 'text-ink-500'}`} aria-current={active ? 'page' : undefined}>
                <it.Icon width={22} height={22} strokeWidth={active ? 2.2 : 1.75} aria-hidden="true" />
                {it.label}
                {it.href === '/cart' && cartCount > 0 && <span className="absolute top-1.5 right-[calc(50%-18px)] inline-flex min-w-[16px] items-center justify-center rounded-full bg-brand-500 px-1 text-[9px] font-bold text-white">{cartCount}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
