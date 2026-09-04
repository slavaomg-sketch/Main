import type { DbClient, Prisma, PrismaClient } from '@techmatch/database';
import { ConflictError, NotFoundError } from '../shared/errors';
import { consumeReservations, releaseReservations, restock } from '../inventory/service';
import { canTransition, CANCELLABLE_BY_CUSTOMER, CONSUMED_STATUSES, RESERVING_STATUSES, type OrderStatus } from './state';
import { getDeliveryProvider } from '../providers';
import { sendOrderStatusChanged } from '../notifications/service';

export const orderInclude = {
  items: true,
  payments: { orderBy: { createdAt: 'desc' as const } },
  shipments: { orderBy: { createdAt: 'desc' as const } },
  statusHistory: { orderBy: { createdAt: 'asc' as const } },
  refunds: true,
  customer: { select: { id: true, email: true, firstName: true, lastName: true } },
} satisfies Prisma.OrderInclude;

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export async function getOrderByPublicId(db: DbClient, publicId: string): Promise<OrderRow> {
  const order = await db.order.findUnique({ where: { publicId }, include: orderInclude });
  if (!order) throw new NotFoundError('Заказ', publicId);
  return order;
}

export async function getOrderById(db: DbClient, id: string): Promise<OrderRow> {
  const order = await db.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) throw new NotFoundError('Заказ', id);
  return order;
}

export interface TransitionInput {
  orderId: string;
  to: OrderStatus;
  actorType: 'SYSTEM' | 'ADMIN' | 'CUSTOMER';
  actorId?: string | null;
  comment?: string | null;
}

/**
 * Единственная точка смены статуса. Проверяет автомат, управляет резервами/остатками,
 * пишет историю и уведомляет клиента.
 */
export async function transitionOrder(db: PrismaClient, input: TransitionInput): Promise<OrderRow> {
  const result = await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: OrderStatus }>>`SELECT id, status FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const current = locked[0];
    if (!current) throw new NotFoundError('Заказ', input.orderId);
    if (current.status === input.to) return { changed: false, from: current.status };
    if (!canTransition(current.status, input.to)) {
      throw new ConflictError(`Переход ${current.status} → ${input.to} недопустим`);
    }
    // Побочные эффекты по остаткам
    if (input.to === 'PAID' && RESERVING_STATUSES.includes(current.status)) await consumeReservations(tx, input.orderId);
    if (input.to === 'CANCELLED') {
      if (RESERVING_STATUSES.includes(current.status)) await releaseReservations(tx, input.orderId, 'RELEASED');
      else if (CONSUMED_STATUSES.includes(current.status)) {
        const items = await tx.orderItem.findMany({ where: { orderId: input.orderId, variantId: { not: null } } });
        await restock(tx, items.map((i) => ({ variantId: i.variantId!, quantity: i.quantity })));
      }
    }
    if (input.to === 'REFUNDED') {
      const items = await tx.orderItem.findMany({ where: { orderId: input.orderId, variantId: { not: null } } });
      await restock(tx, items.map((i) => ({ variantId: i.variantId!, quantity: i.quantity })));
    }
    await tx.order.update({
      where: { id: input.orderId },
      data: {
        status: input.to,
        ...(input.to === 'PAID' ? { paidAt: new Date() } : {}),
        ...(input.to === 'CANCELLED' ? { cancelledAt: new Date(), cancelReason: input.comment ?? null } : {}),
        statusHistory: { create: { fromStatus: current.status, toStatus: input.to, actorType: input.actorType, actorId: input.actorId ?? null, comment: input.comment ?? null } },
      },
    });
    return { changed: true, from: current.status };
  });
  const order = await getOrderById(db, input.orderId);
  if (result.changed) {
    try {
      await sendOrderStatusChanged(db, order);
    } catch (e) {
      console.warn('[notifications] не удалось отправить уведомление', e);
    }
  }
  return order;
}

export async function cancelOrderByCustomer(db: PrismaClient, input: { orderId: string; customerId: string; reason?: string }) {
  const order = await getOrderById(db, input.orderId);
  if (order.customerId !== input.customerId) throw new NotFoundError('Заказ');
  if (!CANCELLABLE_BY_CUSTOMER.includes(order.status)) throw new ConflictError('Заказ уже нельзя отменить самостоятельно, обратитесь в поддержку');
  return transitionOrder(db, { orderId: order.id, to: 'CANCELLED', actorType: 'CUSTOMER', actorId: input.customerId, comment: input.reason ?? 'Отменён покупателем' });
}

/** Просроченные неоплаченные заказы → отмена и освобождение резерва (фоновая задача). */
export async function expireUnpaidOrders(db: PrismaClient, now = new Date()): Promise<number> {
  const orders = await db.order.findMany({ where: { status: 'PENDING_PAYMENT', reservationExpiresAt: { lt: now } }, select: { id: true } });
  let n = 0;
  for (const o of orders) {
    await transitionOrder(db, { orderId: o.id, to: 'CANCELLED', actorType: 'SYSTEM', comment: 'Истёк срок резерва: оплата не поступила' });
    n += 1;
  }
  return n;
}

export async function createShipmentForOrder(db: PrismaClient, orderId: string, actorId?: string | null) {
  const order = await getOrderById(db, orderId);
  const provider = getDeliveryProvider();
  const addr = order.shippingAddress as Record<string, string>;
  const weight = order.items.reduce((s, i) => s + 150 * i.quantity, 0);
  const created = await provider.createShipment({
    orderPublicId: order.publicId,
    methodCode: order.deliveryMethodCode,
    address: { country: addr.country ?? 'RU', city: addr.city ?? '', street: addr.street, building: addr.building, apartment: addr.apartment, postalCode: addr.postalCode, region: addr.region },
    recipient: { fullName: order.fullName, phone: order.phone, email: order.email },
    weightGrams: weight,
    declaredValueMinor: order.subtotalMinor,
  });
  const shipment = await db.shipment.create({
    data: { orderId: order.id, provider: provider.code, providerShipmentId: created.providerShipmentId, trackingNumber: created.trackingNumber, status: 'LABEL_CREATED', methodCode: order.deliveryMethodCode, costMinor: order.deliveryCostMinor, estimatedAt: created.estimatedAt, events: [{ at: new Date().toISOString(), status: 'LABEL_CREATED', description: 'Накладная создана' }] },
  });
  if (order.status === 'READY_FOR_SHIPMENT') {
    await transitionOrder(db, { orderId: order.id, to: 'SHIPPED', actorType: actorId ? 'ADMIN' : 'SYSTEM', actorId, comment: `Отправление ${shipment.trackingNumber ?? shipment.providerShipmentId}` });
  }
  return shipment;
}

export interface OrderListFilter {
  status?: OrderStatus | null;
  query?: string | null;
  customerId?: string | null;
  from?: Date | null;
  to?: Date | null;
  page?: number;
  perPage?: number;
}

export async function listOrders(db: DbClient, f: OrderListFilter) {
  const page = Math.max(1, f.page ?? 1);
  const perPage = Math.min(100, f.perPage ?? 25);
  const where: Prisma.OrderWhereInput = {};
  if (f.status) where.status = f.status;
  if (f.customerId) where.customerId = f.customerId;
  if (f.from || f.to) where.createdAt = { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) };
  if (f.query) where.OR = [{ publicId: { contains: f.query, mode: 'insensitive' } }, { email: { contains: f.query, mode: 'insensitive' } }, { phone: { contains: f.query } }, { fullName: { contains: f.query, mode: 'insensitive' } }];
  const [items, total] = await Promise.all([
    db.order.findMany({ where, include: { items: true, payments: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
    db.order.count({ where }),
  ]);
  return { items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
}

export async function requestRefund(db: PrismaClient, input: { orderId: string; amountMinor?: number; reason?: string; actorId?: string | null }) {
  const order = await getOrderById(db, input.orderId);
  const payment = order.payments.find((p) => p.status === 'SUCCEEDED');
  if (!payment) throw new ConflictError('У заказа нет успешного платежа');
  const amount = input.amountMinor ?? order.totalMinor;
  if (amount <= 0 || amount > order.totalMinor) throw new ConflictError('Некорректная сумма возврата');
  const refund = await db.refund.create({ data: { orderId: order.id, paymentId: payment.id, amountMinor: amount, reason: input.reason ?? null, status: 'PENDING' } });
  await transitionOrder(db, { orderId: order.id, to: 'REFUND_PENDING', actorType: 'ADMIN', actorId: input.actorId, comment: `Запрошен возврат ${Math.floor(amount / 100)} ₽` });
  return refund;
}
