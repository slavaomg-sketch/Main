import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { allowedTransitions, formatRub, getOrderById, NotFoundError, ORDER_STATUS_LABEL } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { AdminPage, Table } from '@/components/admin/ui';
import { OrderStatusBadge } from '@/components/cart/order-status';
import { OrderActions } from '@/components/admin/order-actions';
import { CompatBadge } from '@/components/ui/compat-badge';
import { formatDateTime } from '@/lib/format';

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('orders.read');
  const { id } = await params;
  let order: Awaited<ReturnType<typeof getOrderById>>;
  try {
    order = await getOrderById(prisma, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const addr = order.shippingAddress as Record<string, string>;
  const canWrite = admin.permissions.includes('orders.write') || admin.roleCode === 'owner' || admin.roleCode === 'admin';
  return (
    <AdminPage title={`Заказ ${order.publicId}`} description={`Создан ${formatDateTime(order.createdAt)}`} actions={<OrderStatusBadge status={order.status} />}>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Table>
            <thead><tr><th>Товар</th><th>SKU</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th>Совместимость</th></tr></thead>
            <tbody>
              {order.items.map((i) => <tr key={i.id}><td>{i.productId ? <Link href={`/admin/products/${i.productId}`} className="text-brand-600">{i.name}</Link> : i.name}</td><td>{i.sku}</td><td>{i.quantity}</td><td>{formatRub(i.unitPriceMinor)}</td><td>{formatRub(i.totalMinor)}</td><td>{i.compatibilityStatus ? <CompatBadge status={i.compatibilityStatus} short /> : '—'}</td></tr>)}
              <tr><td colSpan={4} className="text-right text-ink-500">Товары</td><td colSpan={2}>{formatRub(order.subtotalMinor)}</td></tr>
              {order.discountMinor > 0 && <tr><td colSpan={4} className="text-right text-ink-500">Скидка {order.couponCode ?? ''}</td><td colSpan={2}>−{formatRub(order.discountMinor)}</td></tr>}
              <tr><td colSpan={4} className="text-right text-ink-500">Доставка ({order.deliveryMethodCode}, {order.deliveryProviderCode})</td><td colSpan={2}>{formatRub(order.deliveryCostMinor)}</td></tr>
              <tr><td colSpan={4} className="text-right font-bold">Итого</td><td colSpan={2} className="font-bold">{formatRub(order.totalMinor)}</td></tr>
            </tbody>
          </Table>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <section className="card p-5 text-[13px]">
              <h2 className="mb-2 text-[15px] font-bold">Покупатель и доставка</h2>
              <p><b>{order.fullName}</b>{order.customer && <> · <Link href={`/admin/customers/${order.customer.id}`} className="text-brand-600">карточка клиента</Link></>}</p>
              <p className="text-ink-600">{order.phone} · {order.email}</p>
              <p className="mt-2">{[addr.postalCode, addr.region, addr.city, addr.street, addr.building && `д. ${addr.building}`, addr.apartment && `кв. ${addr.apartment}`].filter(Boolean).join(', ')}</p>
              {order.comment && <p className="mt-2 text-ink-600">Комментарий покупателя: {order.comment}</p>}
              {order.shipments.map((s) => <p key={s.id} className="mt-2">Отправление: {s.provider} · {s.trackingNumber ?? s.providerShipmentId} · {s.status}</p>)}
            </section>
            <section className="card p-5 text-[13px]">
              <h2 className="mb-2 text-[15px] font-bold">Платежи</h2>
              {order.payments.map((p) => <p key={p.id}>{p.provider} · <b>{p.status}</b> · {formatRub(p.amountMinor)}{p.failureReason && <span className="text-danger-500"> · {p.failureReason}</span>}<span className="block text-[12px] text-ink-500">{p.providerPaymentId} · {formatDateTime(p.updatedAt)}</span></p>)}
              {order.refunds.map((r) => <p key={r.id} className="mt-1">Возврат: <b>{r.status}</b> · {formatRub(r.amountMinor)}{r.reason ? ` · ${r.reason}` : ''}</p>)}
              {order.reservationExpiresAt && order.status === 'PENDING_PAYMENT' && <p className="mt-2 text-warning-500">Резерв до {formatDateTime(order.reservationExpiresAt)}</p>}
            </section>
          </div>
          <section className="card p-5">
            <h2 className="mb-2 text-[15px] font-bold">История</h2>
            <ol className="space-y-1.5 text-[13px]">{order.statusHistory.map((h) => <li key={h.id} className="flex gap-3"><span className="w-32 shrink-0 text-ink-400">{formatDateTime(h.createdAt)}</span><span><b>{ORDER_STATUS_LABEL[h.toStatus]}</b> <span className="text-ink-500">({h.actorType.toLowerCase()})</span>{h.comment ? ` — ${h.comment}` : ''}</span></li>)}</ol>
          </section>
        </div>
        <div>
          {canWrite ? <OrderActions orderId={order.id} status={order.status} allowed={allowedTransitions(order.status)} notes={order.managerNotes ?? ''} hasSuccessfulPayment={order.payments.some((p) => p.status === 'SUCCEEDED')} hasShipment={order.shipments.length > 0} totalRub={order.totalMinor / 100} /> : <p className="card p-4 text-[13px] text-ink-500">Просмотр без права изменения.</p>}
        </div>
      </div>
    </AdminPage>
  );
}
