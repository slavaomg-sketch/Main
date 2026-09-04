import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogOut, Package, Smartphone, User } from 'lucide-react';
import { logoutAction } from '@/server/actions/account';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

const NAV = [
  { href: '/account', label: 'Профиль', Icon: User },
  { href: '/account/devices', label: 'Мои устройства', Icon: Smartphone },
  { href: '/account/orders', label: 'Заказы', Icon: Package },
];

export function AccountShell({ title, current, children }: { title: string; current: string; children: ReactNode }) {
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: 'Личный кабинет', href: '/account' }, ...(current !== '/account' ? [{ label: title }] : [])]} />
      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="card h-fit p-2" aria-label="Личный кабинет">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`flex min-h-10 items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-[13.5px] font-medium ${current === n.href ? 'bg-brand-50 text-brand-600' : 'hover:bg-ink-100'}`} aria-current={current === n.href ? 'page' : undefined}>
              <n.Icon width={17} height={17} /> {n.label}
            </Link>
          ))}
          <form action={logoutAction}>
            <button type="submit" className="flex min-h-10 w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-left text-[13.5px] font-medium text-ink-600 hover:bg-ink-100"><LogOut width={17} height={17} /> Выйти</button>
          </form>
        </nav>
        <div>
          <h1 className="h2 mb-4">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
