import Link from 'next/link';
import { prisma } from '@techmatch/database';
import { describeProviders, failedDeviceSearches, formatRub, listProductsWithoutVerifiedCompatibility, maybeRunInlineMaintenance, ORDER_STATUS_LABEL, type OrderStatus } from '@techmatch/domain';
import { getEnv } from '@techmatch/config';
import { requireAdmin } from '@/lib/admin';
import { AdminPage, Stat, Table } from '@/components/admin/ui';
import { OrderStatusBadge } from '@/components/cart/order-status';
import { formatDateTime } from '@/lib/format';

export default async function AdminDashboard() {
  await requireAdmin('dashboard.view');
  if (getEnv().QUEUE_DRIVER === 'inline') await maybeRunInlineMaintenance(prisma);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [ordersTotal, ordersByStatus, revenue, revenueToday, products, lowStock, failedSearches, noCompat, importErrors, recentAudit, recentOrders, customers] = await Promise.all([
    prisma.order.count(),
    prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.order.aggregate({ where: { paidAt: { gte: since }, status: { notIn: ['CANCELLED', 'REFUNDED'] } }, _sum: { totalMinor: true } }),
    prisma.order.aggregate({ where: { paidAt: { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) }, status: { notIn: ['CANCELLED', 'REFUNDED'] } }, _sum: { totalMinor: true } }),
    prisma.product.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.inventory.findMany({ where: { quantity: { lte: 5 } }, include: { variant: { include: { product: { select: { name: true, id: true } } } } }, take: 8, orderBy: { quantity: 'asc' } }),
    failedDeviceSearches(prisma, 8),
    listProductsWithoutVerifiedCompatibility(prisma, 8),
    prisma.importIssue.count({ where: { level: 'ERROR', createdAt: { gte: since } } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, publicId: true, status: true, totalMinor: true, createdAt: true, fullName: true } }),
    prisma.customer.count(),
  ]);
  const providers = describeProviders();
  const count = (s: OrderStatus) => ordersByStatus.find((x) => x.status === s)?._count._all ?? 0;
  const active = products.find((p) => p.status === 'ACTIVE')?._count._all ?? 0;
  return (
    <AdminPage title="Дашборд" description="Ключевые показатели магазина">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Заказов всего" value={ordersTotal} hint={`ожидают оплаты: ${count('PENDING_PAYMENT')} · в работе: ${count('PAID') + count('PROCESSING') + count('READY_FOR_SHIPMENT')}`} href="/admin/orders" />
        <Stat label="Выручка за 30 дней" value={formatRub(revenue._sum.totalMinor ?? 0)} hint={`сегодня: ${formatRub(revenueToday._sum.totalMinor ?? 0)}`} href="/admin/orders?status=PAID" />
        <Stat label="Активных товаров" value={active} hint={`черновиков: ${products.find((p) => p.status === 'DRAFT')?._count._all ?? 0}`} href="/admin/products" />
        <Stat label="Клиентов" value={customers} href="/admin/customers" />
        <Stat label="Мало на складе" value={lowStock.length} hint="остаток ≤ 5 шт." href="/admin/products?stock=low" />
        <Stat label="Неудачных поисков" value={failedSearches.reduce((s, f) => s + f._count.normalized, 0)} hint="устройства, которых нет в базе" href="/admin/devices?tab=failed" />
        <Stat label="Без подтверждённой совместимости" value={noCompat.length >= 8 ? '8+' : noCompat.length} href="/admin/compatibility?tab=unverified" />
        <Stat label="Ошибок импорта за 30 дней" value={importErrors} href="/admin/imports" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section>
          <h2 className="mb-2 text-[15px] font-bold">Последние заказы</h2>
          <Table>
            <thead><tr><th>Номер</th><th>Покупатель</th><th>Статус</th><th>Сумма</th><th>Создан</th></tr></thead>
            <tbody>
              {recentOrders.map((o) => (
                <tr key={o.id}><td><Link href={`/admin/orders/${o.id}`} className="font-semibold text-brand-600">{o.publicId}</Link></td><td>{o.fullName}</td><td><OrderStatusBadge status={o.status} /></td><td>{formatRub(o.totalMinor)}</td><td>{formatDateTime(o.createdAt)}</td></tr>
              ))}
            </tbody>
          </Table>
        </section>
        <section>
          <h2 className="mb-2 text-[15px] font-bold">Неудачные поиски устройств</h2>
          <Table>
            <thead><tr><th>Запрос</th><th>Раз</th><th>Последний</th></tr></thead>
            <tbody>
              {failedSearches.length === 0 && <tr><td colSpan={3} className="text-ink-500">Нет данных</td></tr>}
              {failedSearches.map((f) => (
                <tr key={f.normalized}><td>{f.normalized}</td><td>{f._count.normalized}</td><td>{f._max.createdAt ? formatDateTime(f._max.createdAt) : '—'}</td></tr>
              ))}
            </tbody>
          </Table>
        </section>
        <section>
          <h2 className="mb-2 text-[15px] font-bold">Товары без подтверждённой совместимости</h2>
          <Table>
            <thead><tr><th>Товар</th><th>Категория</th></tr></thead>
            <tbody>
              {noCompat.map((p) => (
                <tr key={p.id}><td><Link href={`/admin/products/${p.id}`} className="text-brand-600">{p.name}</Link></td><td>{p.category.name}</td></tr>
              ))}
            </tbody>
          </Table>
        </section>
        <section>
          <h2 className="mb-2 text-[15px] font-bold">Мало на складе</h2>
          <Table>
            <thead><tr><th>Товар</th><th>SKU</th><th>Остаток</th></tr></thead>
            <tbody>
              {lowStock.map((i) => (
                <tr key={i.id}><td><Link href={`/admin/products/${i.variant.product.id}`} className="text-brand-600">{i.variant.product.name}</Link></td><td>{i.variant.sku}</td><td className={i.quantity === 0 ? 'font-semibold text-danger-500' : ''}>{i.quantity}</td></tr>
              ))}
            </tbody>
          </Table>
        </section>
        <section>
          <h2 className="mb-2 text-[15px] font-bold">Последние действия</h2>
          <Table>
            <thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Объект</th></tr></thead>
            <tbody>
              {recentAudit.map((a) => (
                <tr key={a.id}><td>{formatDateTime(a.createdAt)}</td><td>{a.actorEmail ?? a.actorType}</td><td>{a.action}</td><td className="text-ink-500">{a.entityType}{a.entityId ? ` ${a.entityId.slice(0, 8)}…` : ''}</td></tr>
              ))}
            </tbody>
          </Table>
        </section>
        <section>
          <h2 className="mb-2 text-[15px] font-bold">Интеграции</h2>
          <div className="card divide-y divide-ink-100 text-[13px]">
            {[
              ['Платежи', providers.payment.code, providers.payment.mode],
              ['Доставка', providers.delivery.code, providers.delivery.mode],
              ['Уведомления', providers.notifications.code, providers.notifications.mode],
              ['Фискализация', providers.fiscal.code, providers.fiscal.mode],
              ...providers.marketplaces.map((m) => [m.name, m.code, m.configured ? 'live' : 'не настроен']),
            ].map(([label, code, mode]) => (
              <div key={label} className="flex items-center justify-between px-4 py-2.5"><span>{label} <span className="text-ink-400">({code})</span></span><span className={`badge ${mode === 'live' ? 'bg-success-100 text-success-500' : 'bg-warning-100 text-warning-500'}`}>{mode === 'mock' ? 'mock / sandbox' : mode}</span></div>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-ink-500">Реальные провайдеры включаются ключами в .env — см. docs/DEPLOYMENT.md.</p>
        </section>
      </div>
      <p className="mt-4 text-[12px] text-ink-500">Статусы заказов: {ordersByStatus.map((s) => `${ORDER_STATUS_LABEL[s.status]}: ${s._count._all}`).join(' · ')}</p>
    </AdminPage>
  );
}
