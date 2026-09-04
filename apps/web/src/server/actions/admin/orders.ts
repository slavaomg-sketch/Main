'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@techmatch/database';
import { createShipmentForOrder, requestRefund, transitionOrder, writeAudit, type OrderStatus } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { runAction, type ActionResult } from '@/lib/errors';

export async function orderTransitionAction(orderId: string, to: OrderStatus, comment?: string): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('orders.write');
  return runAction(async () => {
    const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
    await transitionOrder(prisma, { orderId, to, actorType: 'ADMIN', actorId: admin.id, comment: comment ?? null });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'order.status_change', entityType: 'Order', entityId: orderId, before: { status: before.status }, after: { status: to, comment } });
    revalidatePath(`/admin/orders/${orderId}`);
    return undefined;
  });
}

export async function orderNotesAction(orderId: string, formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('orders.write');
  return runAction(async () => {
    const notes = String(formData.get('managerNotes') ?? '').slice(0, 2000);
    const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { managerNotes: true } });
    await prisma.order.update({ where: { id: orderId }, data: { managerNotes: notes } });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'order.notes', entityType: 'Order', entityId: orderId, before: { managerNotes: before.managerNotes }, after: { managerNotes: notes } });
    revalidatePath(`/admin/orders/${orderId}`);
    return undefined;
  });
}

export async function createShipmentAction(orderId: string): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('orders.write');
  return runAction(async () => {
    const s = await createShipmentForOrder(prisma, orderId, admin.id);
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'order.shipment.create', entityType: 'Order', entityId: orderId, after: { shipmentId: s.id, trackingNumber: s.trackingNumber } });
    revalidatePath(`/admin/orders/${orderId}`);
    return undefined;
  });
}

export async function refundAction(orderId: string, formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('orders.write');
  return runAction(async () => {
    const rub = Number(formData.get('amountRub') ?? 0);
    const reason = String(formData.get('reason') ?? '');
    await requestRefund(prisma, { orderId, amountMinor: rub > 0 ? Math.round(rub * 100) : undefined, reason, actorId: admin.id });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'order.refund.request', entityType: 'Order', entityId: orderId, after: { amountRub: rub, reason } });
    revalidatePath(`/admin/orders/${orderId}`);
    return undefined;
  });
}

/** Подтверждение возврата вручную (когда провайдер не шлёт webhook — mock/оффлайн). */
export async function completeRefundAction(orderId: string): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('orders.write');
  return runAction(async () => {
    await prisma.refund.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'SUCCEEDED', processedAt: new Date() } });
    await prisma.payment.updateMany({ where: { orderId, status: 'SUCCEEDED' }, data: { status: 'REFUNDED' } });
    await transitionOrder(prisma, { orderId, to: 'REFUNDED', actorType: 'ADMIN', actorId: admin.id, comment: 'Возврат подтверждён менеджером' });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'order.refund.complete', entityType: 'Order', entityId: orderId });
    revalidatePath(`/admin/orders/${orderId}`);
    return undefined;
  });
}
