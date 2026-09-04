import Link from 'next/link';
import { prisma } from '@techmatch/database';
import { formatRub, listOrders, ORDER_STATUS_LABEL, type OrderStatus } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { AdminPage, Table } from '@/components/admin/ui';
import { OrderStatusBadge } from '@/components/cart/order-status';
import { Pagination } from '@/components/ui/pagination';
import { formatDateTime } from '@/lib/format';

export default async function AdminOrders({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string; from?: string; to?: string }> }) {
  await requireAdmin('orders.read');
  const sp = await searchParams;
  const res = await listOrders(prisma, { query: sp.q ?? null, status: (sp.status as OrderStatus) || null, page: Number(sp.page ?? 1) || 1, perPage: 30, from: sp.from ? new Date(sp.from) : null, to: sp.to ? new Date(`${sp.to}T23:59:59Z`) : null });
  return (
    <AdminPage title="Заказы" description={`${res.total} заказов`}>
      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <input name="q" defaultValue={sp.q ?? ''} className="input min-h-9 max-w-xs" placeholder="Номер, email, телефон, имя" aria-label="Поиск" />
        <select name="status" defaultValue={sp.status ?? ''} className="input min-h-9 w-auto" aria-label="Статус"><option value="">Все статусы</option>{Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input name="from" type="date" defaultValue={sp.from ?? ''} className="input min-h-9 w-auto" aria-label="С даты" />
        <input name="to" type="date" defaultValue={sp.to ?? ''} className="input min-h-9 w-auto" aria-label="По дату" />
        <button type="submit" className="btn btn-outline btn-sm">Фильтровать</button>
      </form>
      <Table>
        <thead><tr><th>Номер</th><th>Покупатель</th><th>Позиции</th><th>Статус</th><th>Оплата</th><th>Сумма</th><th>Создан</th></tr></thead>
        <tbody>
          {res.items.map((o) => (
            <tr key={o.id} data-testid="admin-order-row">
              <td><Link href={`/admin/orders/${o.id}`} className="font-semibold text-brand-600">{o.publicId}</Link></td>
              <td>{o.fullName}<div className="text-[12px] text-ink-500">{o.email}</div></td>
              <td>{o.items.reduce((s, i) => s + i.quantity, 0)}</td>
              <td><OrderStatusBadge status={o.status} /></td>
              <td className="text-[12px]">{o.payments[0] ? `${o.payments[0].provider} · ${o.payments[0].status}` : '—'}</td>
              <td>{formatRub(o.totalMinor)}</td>
              <td>{formatDateTime(o.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={res.page} pages={res.pages} hrefFor={(p) => `/admin/orders?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), page: String(p) })}`} />
    </AdminPage>
  );
}
