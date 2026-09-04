import Link from 'next/link';
import { ChevronDown, Heart, ShoppingCart, User } from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { Icon } from '@/components/ui/icon';
import { GlobalSearch } from '@/components/devices/global-search';
import { MobileMenu } from '@/components/layout/mobile-menu';
import { CatalogMenu } from '@/components/layout/catalog-menu';
import type { HomepageSettings } from '@techmatch/domain';

export interface HeaderData {
  cartCount: number;
  favoritesCount: number;
  isLoggedIn: boolean;
  benefits: HomepageSettings['headerBenefits'];
  categories: Array<{ slug: string; name: string; icon: string | null; children: Array<{ slug: string; name: string }> }>;
  deviceCategories: Array<{ slug: string; name: string; icon: string }>;
  activeDevice: { slug: string; name: string } | null;
}

const NAV = [
  { href: '/devices', label: 'Подбор по устройству' },
  { href: '/bundles', label: 'Комплекты' },
  { href: '/brands', label: 'Бренды' },
  { href: '/catalog?new=1', label: 'Новинки' },
  { href: '/catalog?sale=1', label: 'Акции' },
  { href: '/help', label: 'Поддержка' },
];

export function Header({ data }: { data: HeaderData }) {
  return (
    <header className="sticky top-0 z-40 bg-surface shadow-[0_1px_0_0_var(--color-ink-200)]">
      {/* Верхняя строка */}
      <div className="shell flex h-14 items-center gap-3 sm:h-16 sm:gap-6">
        <MobileMenu nav={NAV} categories={data.categories} deviceCategories={data.deviceCategories} activeDevice={data.activeDevice} />
        <Logo />
        <div className="hidden min-w-0 flex-1 md:block">
          <GlobalSearch />
        </div>
        <nav className="ml-auto flex items-center gap-0.5 sm:gap-1" aria-label="Пользователь">
          <Link href={data.isLoggedIn ? '/account' : '/account/login'} className="icon-btn" aria-label={data.isLoggedIn ? 'Личный кабинет' : 'Войти'}>
            <User width={22} height={22} strokeWidth={1.75} />
          </Link>
          <Link href="/favorites" className="icon-btn relative" aria-label="Избранное">
            <Heart width={22} height={22} strokeWidth={1.75} />
            {data.favoritesCount > 0 && <Count n={data.favoritesCount} />}
          </Link>
          <Link href="/cart" className="icon-btn relative" aria-label={`Корзина, товаров: ${data.cartCount}`}>
            <ShoppingCart width={22} height={22} strokeWidth={1.75} />
            <Count n={data.cartCount} />
          </Link>
        </nav>
      </div>
      <div className="shell pb-2.5 md:hidden">
        <GlobalSearch compact />
      </div>
      {/* Вторая строка навигации */}
      <div className="hidden bg-canvas md:block">
        <div className="shell flex h-11 items-center gap-1">
          <CatalogMenu categories={data.categories} deviceCategories={data.deviceCategories}>
            <span className="inline-flex h-11 items-center gap-1.5 px-3 text-[13px] font-semibold text-ink-900 hover:bg-ink-200/60">
              Каталог <ChevronDown width={15} height={15} aria-hidden="true" />
            </span>
          </CatalogMenu>
          {NAV.map((n, i) => (
            <Link key={n.href} href={n.href} className={`inline-flex h-11 items-center px-3 text-[13px] font-medium text-ink-800 hover:bg-ink-200/60 ${i === 0 ? 'bg-ink-200/50' : ''}`}>
              {n.label}
            </Link>
          ))}
          <div className="ml-auto hidden items-center gap-6 lg:flex">
            {data.benefits.map((b) => (
              <div key={b.title} className="flex items-center gap-2">
                <Icon name={b.icon} width={22} height={22} strokeWidth={1.6} className="text-ink-700" />
                <span className="text-[11px] leading-[1.2] text-ink-800">
                  <span className="block font-semibold">{b.title}</span>
                  <span className="block text-ink-600">{b.text}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="absolute top-1 right-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-brand-500 px-1 py-[1px] text-[10px] font-bold text-white" aria-hidden="true">
      {n}
    </span>
  );
}
