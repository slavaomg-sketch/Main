import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { CANCELLABLE_BY_CUSTOMER, formatRub, listOrders } from '@techmatch/domain';
import { AccountShell } from '@/components/account/account-shell';
import { OrderStatusBadge } from '@/components/cart/order-status';
import { CancelOrderButton } from '@/components/account/cancel-order';
import { getCustomer } from '@/lib/session';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Мои заказы', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const session = await getCustomer();
  if (!session) redirect('/account/login?next=/account/orders');
  const { items } = await listOrders(prisma, { customerId: session.customer.id, perPage: 50 });
  return (
    <AccountShell title="Мои заказы" current="/account/orders">
      {items.length === 0 ? (
        <p className="text-[13px] text-ink-500">Заказов пока нет. <Link href="/catalog" className="text-brand-500 underline">В каталог</Link></p>
      ) : (
        <ul className="space-y-3" data-testid="orders-list">
          {items.map((o) => (
            <li key={o.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Link href={`/order/${o.publicId}`} className="text-[15px] font-bold hover:text-brand-600">{o.publicId}</Link>
                  <span className="ml-3 text-[13px] text-ink-500">{formatDate(o.createdAt)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <OrderStatusBadge status={o.status} />
                  <span className="text-[15px] font-bold">{formatRub(o.totalMinor)}</span>
                  {CANCELLABLE_BY_CUSTOMER.includes(o.status) && <CancelOrderButton orderId={o.id} />}
                </div>
              </div>
              <p className="mt-2 text-[13px] text-ink-600">{o.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')}</p>
            </li>
          ))}
        </ul>
      )}
    </AccountShell>
  );
}
