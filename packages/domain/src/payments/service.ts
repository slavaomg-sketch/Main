import type { PrismaClient } from '@techmatch/database';
import type { PaymentWebhookEvent } from '@techmatch/integrations';
import { getPaymentProvider, getFiscalProvider } from '../providers.js';
import { transitionOrder } from '../orders/service.js';

export interface WebhookOutcome {
  accepted: boolean;
  duplicate: boolean;
  orderPublicId?: string;
  message: string;
}

/**
 * Идемпотентная обработка webhook оплаты:
 * событие сохраняется с уникальным (provider, providerEventId) — повтор не меняет состояние.
 */
export async function handlePaymentWebhook(db: PrismaClient, request: { headers: Record<string, string | undefined>; rawBody: string; ip?: string }): Promise<WebhookOutcome> {
  const provider = getPaymentProvider();
  const event = await provider.parseWebhook(request);
  if (!event) return { accepted: false, duplicate: false, message: 'Невалидный webhook (подпись или формат)' };
  return applyPaymentEvent(db, provider.code, event);
}

export async function applyPaymentEvent(db: PrismaClient, providerCode: string, event: PaymentWebhookEvent): Promise<WebhookOutcome> {
  const payment = await db.payment.findFirst({ where: { provider: providerCode, providerPaymentId: event.providerPaymentId }, include: { order: true } });
  // Сохраняем событие атомарно: уникальный индекс гарантирует единственную обработку
  try {
    await db.paymentEvent.create({ data: { paymentId: payment?.id ?? null, provider: providerCode, providerEventId: event.providerEventId, type: event.type, payload: event.raw as object } });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'P2002') return { accepted: true, duplicate: true, orderPublicId: payment?.order.publicId, message: 'Событие уже обработано' };
    throw e;
  }
  if (!payment) return { accepted: true, duplicate: false, message: 'Платёж не найден, событие сохранено' };

  if (event.type === 'payment.succeeded') {
    if (event.amountMinor !== undefined && event.amountMinor !== payment.amountMinor) {
      await db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: `Сумма платежа ${event.amountMinor} не совпадает с ожидаемой ${payment.amountMinor}` } });
      return { accepted: true, duplicate: false, orderPublicId: payment.order.publicId, message: 'Сумма не совпадает' };
    }
    await db.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED' } });
    if (payment.order.status === 'PENDING_PAYMENT') {
      await transitionOrder(db, { orderId: payment.orderId, to: 'PAID', actorType: 'SYSTEM', comment: `Оплата подтверждена (${providerCode})` });
      await registerReceipt(db, payment.orderId);
    }
  } else if (event.type === 'payment.canceled') {
    await db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: 'Платёж отклонён или отменён' } });
    // Заказ остаётся PENDING_PAYMENT — покупатель может оплатить повторно до истечения резерва
  } else if (event.type === 'refund.succeeded') {
    await db.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
    await db.refund.updateMany({ where: { paymentId: payment.id, status: 'PENDING' }, data: { status: 'SUCCEEDED', processedAt: new Date() } });
    if (payment.order.status === 'REFUND_PENDING') await transitionOrder(db, { orderId: payment.orderId, to: 'REFUNDED', actorType: 'SYSTEM', comment: 'Возврат подтверждён' });
  }
  await db.paymentEvent.updateMany({ where: { provider: providerCode, providerEventId: event.providerEventId }, data: { processedAt: new Date() } });
  return { accepted: true, duplicate: false, orderPublicId: payment.order.publicId, message: 'OK' };
}

async function registerReceipt(db: PrismaClient, orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return;
  const fiscal = getFiscalProvider();
  try {
    await fiscal.register({
      orderPublicId: order.publicId,
      customerEmail: order.email,
      items: [...order.items.map((i) => ({ name: i.name, quantity: i.quantity, priceMinor: i.unitPriceMinor, vat: 'vat20' as const })), ...(order.deliveryCostMinor ? [{ name: 'Доставка', quantity: 1, priceMinor: order.deliveryCostMinor, vat: 'vat20' as const }] : [])],
      totalMinor: order.totalMinor,
      paymentMethod: 'card',
      type: 'sell',
    });
  } catch (e) {
    console.warn('[fiscal] чек не зарегистрирован', e);
  }
}

/** Повторная попытка оплаты для заказа в PENDING_PAYMENT. */
export async function createRetryPayment(db: PrismaClient, orderId: string, appUrl: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { payments: { orderBy: { createdAt: 'desc' } } } });
  if (!order || order.status !== 'PENDING_PAYMENT') return null;
  const pending = order.payments.find((p) => p.status === 'PENDING' && p.confirmationUrl);
  if (pending) return pending;
  const provider = getPaymentProvider();
  const key = `pay_${order.id}_${order.payments.length + 1}`;
  const created = await provider.createPayment({ orderId: order.id, orderPublicId: order.publicId, amountMinor: order.totalMinor, currency: 'RUB', description: `Заказ ${order.publicId} в TechMatch`, returnUrl: `${appUrl}/order/${order.publicId}`, customerEmail: order.email, idempotencyKey: key });
  return db.payment.create({ data: { orderId: order.id, provider: provider.code, providerPaymentId: created.providerPaymentId, status: created.status, amountMinor: order.totalMinor, confirmationUrl: created.confirmationUrl, idempotencyKey: key, metadata: { mode: provider.mode } } });
}
