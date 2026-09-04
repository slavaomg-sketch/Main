import Link from 'next/link';
import type { ReactNode } from 'react';
import { BarChart3, ClipboardList, FileText, Import, LayoutDashboard, LogOut, Megaphone, Package, ShieldCheck, Smartphone, Store, Users, UsersRound } from 'lucide-react';
import { roleHasPermission, type Permission } from '@techmatch/domain/admin/rbac';
import { LogoMark } from '@/components/ui/logo';
import { adminLogoutAction } from '@/server/actions/admin/auth';

const NAV: Array<{ href: string; label: string; Icon: typeof LayoutDashboard; permission: Permission }> = [
  { href: '/admin', label: 'Дашборд', Icon: LayoutDashboard, permission: 'dashboard.view' },
  { href: '/admin/products', label: 'Товары', Icon: Package, permission: 'products.read' },
  { href: '/admin/devices', label: 'Устройства', Icon: Smartphone, permission: 'devices.read' },
  { href: '/admin/compatibility', label: 'Совместимость', Icon: ShieldCheck, permission: 'compatibility.read' },
  { href: '/admin/imports', label: 'Импорт и синхронизация', Icon: Import, permission: 'imports.read' },
  { href: '/admin/orders', label: 'Заказы', Icon: ClipboardList, permission: 'orders.read' },
  { href: '/admin/customers', label: 'Клиенты', Icon: UsersRound, permission: 'customers.read' },
  { href: '/admin/content', label: 'Контент', Icon: FileText, permission: 'content.read' },
  { href: '/admin/promotions', label: 'Маркетинг', Icon: Megaphone, permission: 'promotions.read' },
  { href: '/admin/users', label: 'Сотрудники и роли', Icon: Users, permission: 'users.read' },
  { href: '/admin/audit', label: 'Аудит', Icon: BarChart3, permission: 'audit.read' },
];

export interface AdminShellUser {
  name: string;
  roleName: string;
  roleCode: string;
  permissions: string[];
}

export function AdminShell({ admin, current, children }: { admin: AdminShellUser; current: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="border-b border-ink-200 bg-surface md:sticky md:top-0 md:h-screen md:overflow-y-auto md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-4"><LogoMark size={28} /><span className="text-[16px] font-extrabold">TechMatch Admin</span></div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4" aria-label="Разделы">
          {NAV.filter((n) => roleHasPermission(admin.roleCode, admin.permissions, n.permission)).map((n) => {
            const active = n.href === '/admin' ? current === '/admin' : current.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={`flex min-h-10 shrink-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-[13.5px] font-medium whitespace-nowrap ${active ? 'bg-brand-50 text-brand-600' : 'text-ink-700 hover:bg-ink-100'}`} aria-current={active ? 'page' : undefined}>
                <n.Icon width={17} height={17} /> {n.label}
              </Link>
            );
          })}
          <Link href="/" className="flex min-h-10 shrink-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-3 text-[13.5px] font-medium text-ink-700 hover:bg-ink-100"><Store width={17} height={17} /> Витрина</Link>
        </nav>
        <div className="hidden border-t border-ink-200 px-4 py-3 text-[12px] md:block">
          <div className="font-semibold">{admin.name}</div>
          <div className="text-ink-500">{admin.roleName}</div>
          <form action={adminLogoutAction}><button type="submit" className="mt-2 inline-flex items-center gap-1 text-ink-600 hover:text-ink-900"><LogOut width={14} height={14} /> Выйти</button></form>
        </div>
      </aside>
      <main className="min-w-0 p-4 md:p-6">{children}</main>
    </div>
  );
}
