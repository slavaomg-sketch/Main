import type { DbClient } from '@techmatch/database';
import { ConflictError } from '../shared/errors';

export async function getDefaultWarehouse(db: DbClient) {
  const wh = (await db.warehouse.findFirst({ where: { isDefault: true, isActive: true } })) ?? (await db.warehouse.findFirst({ where: { isActive: true } }));
  if (!wh) throw new ConflictError('Нет активного склада');
  return wh;
}

export async function availableForVariant(db: DbClient, variantId: string): Promise<number> {
  const rows = await db.inventory.findMany({ where: { variantId } });
  return rows.reduce((s, r) => s + Math.max(0, r.quantity - r.reservedQuantity), 0);
}

/**
 * Резервирует остатки под заказ. Должно вызываться внутри транзакции.
 * Использует SELECT ... FOR UPDATE, чтобы два параллельных заказа не увели одну единицу.
 */
export async function reserveStock(
  tx: DbClient,
  items: Array<{ variantId: string; quantity: number }>,
  opts: { orderId: string; ttlMinutes: number },
): Promise<void> {
  const warehouse = await getDefaultWarehouse(tx);
  const expiresAt = new Date(Date.now() + opts.ttlMinutes * 60_000);
  for (const item of items) {
    const locked = await tx.$queryRaw<Array<{ id: string; quantity: number; reservedQuantity: number }>>`
      SELECT id, quantity, "reservedQuantity" FROM "Inventory"
      WHERE "variantId" = ${item.variantId} AND "warehouseId" = ${warehouse.id}
      FOR UPDATE`;
    const inv = locked[0];
    const available = inv ? inv.quantity - inv.reservedQuantity : 0;
    if (!inv || available < item.quantity) {
      const variant = await tx.productVariant.findUnique({ where: { id: item.variantId }, select: { name: true, product: { select: { name: true } } } });
      throw new ConflictError(`Недостаточно товара «${variant?.product.name ?? ''} ${variant?.name ?? ''}»: доступно ${Math.max(0, available)}, запрошено ${item.quantity}`, { variantId: item.variantId, available });
    }
    await tx.inventory.update({ where: { id: inv.id }, data: { reservedQuantity: { increment: item.quantity } } });
    await tx.stockReservation.create({ data: { variantId: item.variantId, warehouseId: warehouse.id, orderId: opts.orderId, quantity: item.quantity, status: 'ACTIVE', expiresAt } });
  }
}

/** Списывает резерв в продажу (после оплаты). */
export async function consumeReservations(tx: DbClient, orderId: string): Promise<void> {
  const reservations = await tx.stockReservation.findMany({ where: { orderId, status: 'ACTIVE' } });
  for (const r of reservations) {
    await tx.inventory.updateMany({ where: { variantId: r.variantId, warehouseId: r.warehouseId }, data: { quantity: { decrement: r.quantity }, reservedQuantity: { decrement: r.quantity } } });
    await tx.stockReservation.update({ where: { id: r.id }, data: { status: 'CONSUMED' } });
  }
}

/** Снимает резерв (отмена/просрочка). */
export async function releaseReservations(tx: DbClient, orderId: string, status: 'RELEASED' | 'EXPIRED' = 'RELEASED'): Promise<number> {
  const reservations = await tx.stockReservation.findMany({ where: { orderId, status: 'ACTIVE' } });
  for (const r of reservations) {
    await tx.inventory.updateMany({ where: { variantId: r.variantId, warehouseId: r.warehouseId }, data: { reservedQuantity: { decrement: r.quantity } } });
    await tx.stockReservation.update({ where: { id: r.id }, data: { status } });
  }
  return reservations.length;
}

/** Возврат товара на склад (после возврата денег). */
export async function restock(tx: DbClient, items: Array<{ variantId: string; quantity: number }>): Promise<void> {
  const warehouse = await getDefaultWarehouse(tx);
  for (const item of items) {
    await tx.inventory.upsert({
      where: { variantId_warehouseId: { variantId: item.variantId, warehouseId: warehouse.id } },
      create: { variantId: item.variantId, warehouseId: warehouse.id, quantity: item.quantity },
      update: { quantity: { increment: item.quantity } },
    });
  }
}

/** Находит просроченные резервы (для фонового задания). */
export async function findExpiredReservationOrders(db: DbClient, now = new Date()): Promise<string[]> {
  const rows = await db.stockReservation.findMany({ where: { status: 'ACTIVE', expiresAt: { lt: now }, orderId: { not: null } }, select: { orderId: true }, distinct: ['orderId'] });
  return rows.map((r) => r.orderId!).filter(Boolean);
}

export async function setStock(db: DbClient, variantId: string, quantity: number, warehouseId?: string) {
  const wh = warehouseId ?? (await getDefaultWarehouse(db)).id;
  return db.inventory.upsert({
    where: { variantId_warehouseId: { variantId, warehouseId: wh } },
    create: { variantId, warehouseId: wh, quantity },
    update: { quantity },
  });
}
