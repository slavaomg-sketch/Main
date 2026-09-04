import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { formatRub, getCustomerForAdmin, NotFoundError } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { AdminPage, Table } from '@/components/admin/ui';
import { OrderStatusBadge } from '@/components/cart/order-status';
import { formatDateTime } from '@/lib/format';

export default async function AdminCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin('customers.read');
  const { id } = await params;
  let c: Awaited<ReturnType<typeof getCustomerForAdmin>>;
  try {
    c = await getCustomerForAdmin(prisma, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <AdminPage title={[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email} description={`${c.email}${c.phone ? ` · ${c.phone}` : ''} · с ${formatDateTime(c.createdAt)}`}>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <section>
          <h2 className="mb-2 text-[15px] font-bold">Заказы</h2>
          <Table><thead><tr><th>Номер</th><th>Статус</th><th>Сумма</th><th>Дата</th></tr></thead><tbody>{c.orders.map((o) => <tr key={o.id}><td><Link href={`/admin/orders/${o.id}`} className="text-brand-600">{o.publicId}</Link></td><td><OrderStatusBadge status={o.status} /></td><td>{formatRub(o.totalMinor)}</td><td>{formatDateTime(o.createdAt)}</td></tr>)}</tbody></Table>
        </section>
        <section className="space-y-5">
          <div>
            <h2 className="mb-2 text-[15px] font-bold">Сохранённые устройства</h2>
            <ul className="card divide-y divide-ink-100 text-[13px]">{c.devices.length === 0 && <li className="p-3 text-ink-500">Нет</li>}{c.devices.map((d) => <li key={d.id} className="flex justify-between p-3"><span>{d.deviceModel.name}</span>{d.isPrimary && <span className="badge bg-brand-50 text-brand-600">активное</span>}</li>)}</ul>
          </div>
          <div>
            <h2 className="mb-2 text-[15px] font-bold">Адреса</h2>
            <ul className="card divide-y divide-ink-100 text-[13px]">{c.addresses.length === 0 && <li className="p-3 text-ink-500">Нет</li>}{c.addresses.map((a) => <li key={a.id} className="p-3">{a.city}, {a.street} {a.building}{a.isDefault ? ' · основной' : ''}</li>)}</ul>
          </div>
          <p className="text-[12px] text-ink-500">Обращения в поддержку: модуль тикетов не входит в текущий релиз (см. docs/KNOWN_LIMITATIONS.md).</p>
        </section>
      </div>
    </AdminPage>
  );
}
