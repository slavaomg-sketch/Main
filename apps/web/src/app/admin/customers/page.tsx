import Link from 'next/link';
import { prisma } from '@techmatch/database';
import { listCustomersForAdmin } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { AdminPage, Table } from '@/components/admin/ui';
import { Pagination } from '@/components/ui/pagination';
import { formatDateTime } from '@/lib/format';

export default async function AdminCustomers({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireAdmin('customers.read');
  const sp = await searchParams;
  const res = await listCustomersForAdmin(prisma, { query: sp.q ?? null, page: Number(sp.page ?? 1) || 1 });
  return (
    <AdminPage title="Клиенты" description={`${res.total} клиентов · персональные данные показываются только с правом customers.read`}>
      <form className="mb-4 flex gap-2" method="get"><input name="q" defaultValue={sp.q ?? ''} className="input min-h-9 max-w-xs" placeholder="Email, имя или телефон" aria-label="Поиск" /><button className="btn btn-outline btn-sm" type="submit">Найти</button></form>
      <Table>
        <thead><tr><th>Клиент</th><th>Телефон</th><th>Заказов</th><th>Устройств</th><th>Регистрация</th><th>Последний вход</th></tr></thead>
        <tbody>
          {res.items.map((c) => <tr key={c.id}><td><Link href={`/admin/customers/${c.id}`} className="font-semibold text-brand-600">{[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email}</Link><div className="text-[12px] text-ink-500">{c.email}</div></td><td>{c.phone ?? '—'}</td><td>{c._count.orders}</td><td>{c._count.devices}</td><td>{formatDateTime(c.createdAt)}</td><td>{c.lastLoginAt ? formatDateTime(c.lastLoginAt) : '—'}</td></tr>)}
        </tbody>
      </Table>
      <Pagination page={res.page} pages={res.pages} hrefFor={(p) => `/admin/customers?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`} />
    </AdminPage>
  );
}
