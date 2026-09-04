import type { DbClient } from '@techmatch/database';
import { getEnv } from '@techmatch/config';
import { getNotificationProvider } from '../providers';
import { formatRub } from '../shared/money';
import { ORDER_STATUS_LABEL, type OrderStatus } from '../orders/state';

export async function sendOrderCreated(db: DbClient, orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return;
  const env = getEnv();
  const lines = order.items.map((i) => `• ${i.name} × ${i.quantity} — ${formatRub(i.totalMinor)}`).join('\n');
  await getNotificationProvider().send({
    to: order.email,
    subject: `TechMatch: заказ ${order.publicId} создан`,
    text: `Здравствуйте, ${order.fullName}!\n\nВаш заказ ${order.publicId} создан и ожидает оплаты.\n\n${lines}\n\nДоставка: ${formatRub(order.deliveryCostMinor)}\nИтого: ${formatRub(order.totalMinor)}\n\nСтатус заказа: ${env.APP_URL}/order/${order.publicId}`,
    template: 'order_created',
    data: { orderPublicId: order.publicId },
  });
}

export async function sendOrderStatusChanged(_db: DbClient, order: { email: string; fullName: string; publicId: string; status: string }) {
  const env = getEnv();
  await getNotificationProvider().send({
    to: order.email,
    subject: `TechMatch: заказ ${order.publicId} — ${ORDER_STATUS_LABEL[order.status as OrderStatus] ?? order.status}`,
    text: `Здравствуйте, ${order.fullName}!\n\nСтатус вашего заказа ${order.publicId}: ${ORDER_STATUS_LABEL[order.status as OrderStatus] ?? order.status}.\n\nПодробности: ${env.APP_URL}/order/${order.publicId}`,
    template: 'order_status',
    data: { orderPublicId: order.publicId, status: order.status },
  });
}
