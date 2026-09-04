import type { DbClient } from '@techmatch/database';
import { ValidationError } from '../shared/errors.js';
import type { DiscountRule } from '../pricing/service.js';

export interface CouponCheck {
  valid: boolean;
  reason?: string;
  coupon?: { id: string; code: string; rule: DiscountRule; description: string };
}

/** Проверка промокода (без применения). Причины отказа человекочитаемые. */
export async function validateCoupon(db: DbClient, code: string, ctx: { subtotalMinor: number; customerId?: string | null; now?: Date }): Promise<CouponCheck> {
  const now = ctx.now ?? new Date();
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { valid: false, reason: 'Введите промокод' };
  const coupon = await db.coupon.findUnique({ where: { code: normalized }, include: { promotion: true } });
  if (!coupon || !coupon.isActive) return { valid: false, reason: 'Промокод не найден' };
  if (coupon.startsAt && coupon.startsAt > now) return { valid: false, reason: 'Промокод ещё не действует' };
  if (coupon.endsAt && coupon.endsAt < now) return { valid: false, reason: 'Срок действия промокода истёк' };
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) return { valid: false, reason: 'Лимит использований промокода исчерпан' };
  if (coupon.minSubtotalMinor > ctx.subtotalMinor) return { valid: false, reason: `Промокод действует при сумме заказа от ${Math.floor(coupon.minSubtotalMinor / 100)} ₽` };
  if (coupon.perCustomerLimit != null && ctx.customerId) {
    const used = await db.couponUsage.count({ where: { couponId: coupon.id, customerId: ctx.customerId } });
    if (used >= coupon.perCustomerLimit) return { valid: false, reason: 'Вы уже использовали этот промокод' };
  }
  const rule: DiscountRule = { type: coupon.discountType, value: coupon.value, minSubtotalMinor: coupon.minSubtotalMinor, maxDiscountMinor: coupon.maxDiscountMinor };
  const description = coupon.discountType === 'PERCENT' ? `Скидка ${coupon.value}%` : `Скидка ${Math.floor(coupon.value / 100)} ₽`;
  return { valid: true, coupon: { id: coupon.id, code: coupon.code, rule, description } };
}

/** Фиксирует использование купона в заказе (внутри транзакции создания заказа). */
export async function recordCouponUsage(tx: DbClient, couponId: string, orderId: string, customerId?: string | null) {
  const coupon = await tx.coupon.findUnique({ where: { id: couponId } });
  if (!coupon) throw new ValidationError('Промокод не найден');
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) throw new ValidationError('Лимит использований промокода исчерпан');
  await tx.couponUsage.create({ data: { couponId, orderId, customerId: customerId ?? null } });
  await tx.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });
}

export async function listActivePromotions(db: DbClient, now = new Date()) {
  return db.promotion.findMany({
    where: { isActive: true, OR: [{ startsAt: null }, { startsAt: { lte: now } }], AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] },
    orderBy: { sortOrder: 'asc' },
    include: { category: true, brand: true, products: { select: { id: true } }, coupons: { where: { isActive: true }, select: { code: true } } },
  });
}

export async function listBundles(db: DbClient, opts: { deviceModelId?: string | null; limit?: number } = {}) {
  return db.bundle.findMany({
    where: { isActive: true, ...(opts.deviceModelId ? { devices: { some: { deviceModelId: opts.deviceModelId } } } : {}) },
    orderBy: { sortOrder: 'asc' },
    take: opts.limit,
    include: {
      imageAsset: true,
      devices: { include: { deviceModel: { select: { name: true, slug: true } } } },
      items: {
        orderBy: { sortOrder: 'asc' },
        include: {
          variant: {
            include: {
              product: { include: { images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1, include: { asset: true } }, brand: true } },
              prices: { where: { priceList: 'retail' }, orderBy: { validFrom: 'desc' }, take: 1 },
              inventory: true,
            },
          },
        },
      },
    },
  });
}

export async function getBundleBySlug(db: DbClient, slug: string) {
  const bundles = await listBundles(db);
  return bundles.find((b) => b.slug === slug) ?? null;
}
