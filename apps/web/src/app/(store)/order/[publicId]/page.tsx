import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { formatRub, getOrderByPublicId, NotFoundError, ORDER_STATUS_LABEL } from '@techmatch/domain';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { OrderStatusBadge } from '@/components/cart/order-status';
import { RetryPayment } from '@/components/cart/retry-payment';
import { CompatBadge } from '@/components/ui/compat-badge';
import { formatDateTime } from '@/lib/format';
import { getCustomer } from '@/lib/session';

export const metadata: Metadata = { title: 'Заказ', robots: { index: false } };
export const dynamic = 'force-dynamic';

const METHOD: Record<string, string> = { courier: 'Курьером до двери', pickup: 'Пункт выдачи', post: 'Почта России' };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ publicId: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { publicId } = await params;
  const sp = await searchParams;
  let order: Awaited<ReturnType<typeof getOrderByPublicId>>;
  try {
    order = await getOrderByPublicId(prisma, publicId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const customer = await getCustomer();
  // Гость видит заказ по публичному ID из письма; чужой авторизованный пользователь — нет
  if (order.customerId && customer && order.customerId !== customer.customer.id) notFound();
  const addr = order.shippingAddress as Record<string, string>;
  const lastPayment = order.payments[0];
  const pending = order.status === 'PENDING_PAYMENT';
  return (
    <div className="shell py-5" data-testid="order-page">
      <Breadcrumbs items={[{ label: 'Заказы', href: '/account/orders' }, { label: order.publicId }]} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="h2">Заказ {order.publicId}</h1>
        <OrderStatusBadge status={order.status} />
      </div>
      {sp.paid === '1' && order.status !== 'PENDING_PAYMENT' && <p className="mb-4 rounded-[var(--radius-md)] bg-success-100 px-4 py-3 text-[14px] text-success-500">Спасибо! Оплата получена, заказ передан в обработку.</p>}
      {pending && (
        <div className="mb-5 flex flex-wrap items-center gap-4 rounded-[var(--radius-md)] bg-warning-100 px-4 py-3">
          <p className="text-[14px] text-ink-800">
            Заказ ожидает оплаты. Товары зарезервированы до {order.reservationExpiresAt ? formatDateTime(order.reservationExpiresAt) : '—'}.
            {lastPayment?.status === 'FAILED' && <span className="block text-danger-500">Последняя попытка оплаты не удалась{lastPayment.failureReason ? `: ${lastPayment.failureReason}` : ''}. Попробуйте ещё раз.</span>}
          </p>
          <RetryPayment orderId={order.id} url={lastPayment?.status === 'PENDING' ? lastPayment.confirmationUrl : null} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="card divide-y divide-ink-200">
            {order.items.map((i) => (
              <div key={i.id} className="flex items-center gap-3 p-4">
                <span className="relative size-16 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-ink-100">{i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="64px" className="object-cover" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">{i.name}</span>
                  <span className="block text-[12px] text-ink-500">арт. {i.sku} · {i.quantity} × {formatRub(i.unitPriceMinor)}</span>
                  {i.compatibilityStatus && <CompatBadge status={i.compatibilityStatus} short className="mt-1" />}
                </span>
                <span className="text-[14px] font-semibold">{formatRub(i.totalMinor)}</span>
              </div>
            ))}
          </section>
          <section className="card p-5">
            <h2 className="h3 mb-3">История статусов</h2>
            <ol className="space-y-2">
              {order.statusHistory.map((h) => (
                <li key={h.id} className="flex gap-3 text-[13px]">
                  <span className="w-32 shrink-0 text-ink-400">{formatDateTime(h.createdAt)}</span>
                  <span><b>{ORDER_STATUS_LABEL[h.toStatus]}</b>{h.comment ? ` — ${h.comment}` : ''}</span>
                </li>
              ))}
            </ol>
          </section>
          {order.shipments.length > 0 && (
            <section className="card p-5">
              <h2 className="h3 mb-2">Доставка</h2>
              {order.shipments.map((s) => (
                <p key={s.id} className="text-[13.5px]">{METHOD[s.methodCode] ?? s.methodCode}{s.trackingNumber && <> · трек-номер <b>{s.trackingNumber}</b></>}{s.estimatedAt && <> · ожидается {formatDateTime(s.estimatedAt)}</>}</p>
              ))}
            </section>
          )}
        </div>
        <aside className="space-y-4">
          <section className="card p-5">
            <h2 className="h3 mb-3">Сумма</h2>
            <dl className="space-y-1.5 text-[13.5px]">
              <div className="flex justify-between"><dt className="text-ink-600">Товары</dt><dd>{formatRub(order.subtotalMinor)}</dd></div>
              {order.discountMinor > 0 && <div className="flex justify-between text-success-500"><dt>Скидка{order.couponCode ? ` (${order.couponCode})` : ''}</dt><dd>−{formatRub(order.discountMinor)}</dd></div>}
              <div className="flex justify-between"><dt className="text-ink-600">Доставка</dt><dd>{order.deliveryCostMinor === 0 ? 'Бесплатно' : formatRub(order.deliveryCostMinor)}</dd></div>
            </dl>
            <div className="mt-3 flex items-baseline justify-between border-t border-ink-200 pt-3"><span className="font-semibold">Итого</span><span className="text-[20px] font-bold" data-testid="order-total">{formatRub(order.totalMinor)}</span></div>
            {lastPayment && <p className="mt-2 text-[12px] text-ink-500">Оплата: {lastPayment.provider === 'mock' ? 'тестовый провайдер' : lastPayment.provider} · {lastPayment.status}</p>}
          </section>
          <section className="card p-5 text-[13.5px]">
            <h2 className="h3 mb-2">Получатель</h2>
            <p>{order.fullName}</p>
            <p className="text-ink-600">{order.phone} · {order.email}</p>
            <p className="mt-2">{[addr.postalCode, addr.city, addr.street, addr.building && `д. ${addr.building}`, addr.apartment && `кв. ${addr.apartment}`].filter(Boolean).join(', ')}</p>
            <p className="mt-1 text-ink-600">{METHOD[order.deliveryMethodCode] ?? order.deliveryMethodCode}</p>
            {order.comment && <p className="mt-2 text-ink-600">Комментарий: {order.comment}</p>}
          </section>
          {!customer && <p className="text-[12.5px] text-ink-500"><Link href={`/account/login?next=/order/${order.publicId}`} className="text-brand-500 underline">Войдите</Link>, чтобы видеть все заказы в личном кабинете.</p>}
        </aside>
      </div>
    </div>
  );
}
