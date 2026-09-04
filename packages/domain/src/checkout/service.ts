import { getEnv } from '@techmatch/config';
import type { DbClient, PrismaClient } from '@techmatch/database';
import type { DeliveryQuote } from '@techmatch/integrations';
import { ConflictError, NotFoundError, ValidationError } from '../shared/errors';
import { generateOrderPublicId } from '../shared/ids';
import { calculateTotals } from '../pricing/service';
import { validateCoupon, recordCouponUsage } from '../promotions/service';
import { reserveStock } from '../inventory/service';
import { assertCartReady, cartInclude, loadCartDTO, type CartDTO } from '../cart/service';
import { getDeliveryProvider, getPaymentProvider } from '../providers';
import { evaluateDeviceCatalog } from '../compatibility/service';
import { sendOrderCreated } from '../notifications/service';

export interface ShippingAddressInput {
  fullName: string;
  phone: string;
  email: string;
  country?: string;
  region?: string | null;
  city: string;
  street: string;
  building: string;
  apartment?: string | null;
  postalCode?: string | null;
}

export interface CheckoutInput {
  cartId: string;
  customerId?: string | null;
  address: ShippingAddressInput;
  deliveryMethodCode: string;
  comment?: string | null;
  idempotencyKey: string;
  saveAddress?: boolean;
}

export async function quoteDelivery(dto: CartDTO, address: { city: string; country?: string; postalCode?: string | null }): Promise<DeliveryQuote[]> {
  const provider = getDeliveryProvider();
  return provider.quote({ address: { country: address.country ?? 'RU', city: address.city, postalCode: address.postalCode ?? null }, weightGrams: Math.max(100, dto.weightGrams), subtotalMinor: dto.totals.subtotalMinor });
}

export interface CheckoutResult {
  orderId: string;
  publicId: string;
  totalMinor: number;
  paymentUrl: string | null;
  paymentMode: 'mock' | 'live';
  reused: boolean;
}

/**
 * Транзакционное создание заказа:
 * идемпотентность по ключу → проверка корзины → котировка доставки → резерв остатков (FOR UPDATE)
 * → заказ + позиции + история → купон → платёж у провайдера → корзина CONVERTED.
 */
export async function createOrderFromCart(db: PrismaClient, input: CheckoutInput): Promise<CheckoutResult> {
  const env = getEnv();
  // 1. Идемпотентность
  const existing = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  if (existing) {
    return { orderId: existing.id, publicId: existing.publicId, totalMinor: existing.totalMinor, paymentUrl: existing.payments[0]?.confirmationUrl ?? null, paymentMode: getPaymentProvider().mode, reused: true };
  }
  const cart = await db.cart.findUnique({ where: { id: input.cartId }, include: cartInclude });
  if (!cart || cart.status !== 'ACTIVE') throw new NotFoundError('Корзина');
  const dto = await loadCartDTO(db, cart);
  assertCartReady(dto);

  const quotes = await quoteDelivery(dto, input.address);
  const quote = quotes.find((q) => q.methodCode === input.deliveryMethodCode);
  if (!quote) throw new ValidationError('Выбранный способ доставки недоступен');

  const couponCheck = cart.couponCode ? await validateCoupon(db, cart.couponCode, { subtotalMinor: dto.totals.subtotalMinor, customerId: input.customerId }) : null;
  const totals = calculateTotals(
    dto.lines.map((l) => ({ variantId: l.variantId, productId: l.productId, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor })),
    { discount: couponCheck?.valid ? couponCheck.coupon!.rule : null, deliveryMinor: quote.costMinor, promotionDiscountMinor: dto.totals.promotionDiscountMinor },
  );

  const compat = cart.activeDeviceModelId ? (await evaluateDeviceCatalog(db, cart.activeDeviceModelId)).results : null;
  const publicId = generateOrderPublicId();

  const order = await db.$transaction(
    async (tx) => {
      const created = await tx.order.create({
        data: {
          publicId,
          customerId: input.customerId ?? null,
          cartId: cart.id,
          status: 'DRAFT',
          email: input.address.email,
          phone: input.address.phone,
          fullName: input.address.fullName,
          shippingAddress: { ...input.address, country: input.address.country ?? 'RU' },
          deliveryMethodCode: quote.methodCode,
          deliveryProviderCode: quote.providerCode,
          deliveryCostMinor: quote.costMinor,
          subtotalMinor: totals.subtotalMinor,
          discountMinor: totals.discountMinor + totals.promotionDiscountMinor,
          totalMinor: totals.totalMinor,
          couponId: couponCheck?.valid ? couponCheck.coupon!.id : null,
          couponCode: couponCheck?.valid ? couponCheck.coupon!.code : null,
          comment: input.comment ?? null,
          idempotencyKey: input.idempotencyKey,
          reservationExpiresAt: new Date(Date.now() + env.ORDER_RESERVATION_TTL_MINUTES * 60_000),
          items: {
            create: dto.lines.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              name: `${l.name}${l.variantName && l.variantName !== l.name ? ` — ${l.variantName}` : ''}`,
              sku: l.sku,
              imageUrl: l.imageUrl,
              quantity: l.quantity,
              unitPriceMinor: l.unitPriceMinor,
              totalMinor: l.lineTotalMinor,
              deviceModelId: l.addedForDevice?.id ?? cart.activeDeviceModelId ?? null,
              compatibilityStatus: compat?.get(l.productId)?.status ?? null,
            })),
          },
          statusHistory: { create: { fromStatus: null, toStatus: 'DRAFT', actorType: input.customerId ? 'CUSTOMER' : 'SYSTEM', actorId: input.customerId ?? null, comment: 'Заказ создан' } },
        },
      });
      await reserveStock(tx, dto.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), { orderId: created.id, ttlMinutes: env.ORDER_RESERVATION_TTL_MINUTES });
      if (couponCheck?.valid) await recordCouponUsage(tx, couponCheck.coupon!.id, created.id, input.customerId);
      await tx.order.update({ where: { id: created.id }, data: { status: 'PENDING_PAYMENT', statusHistory: { create: { fromStatus: 'DRAFT', toStatus: 'PENDING_PAYMENT', actorType: 'SYSTEM', comment: 'Остатки зарезервированы' } } } });
      await tx.cart.update({ where: { id: cart.id }, data: { status: 'CONVERTED' } });
      if (input.saveAddress && input.customerId) {
        await tx.address.create({ data: { customerId: input.customerId, fullName: input.address.fullName, phone: input.address.phone, country: input.address.country ?? 'RU', region: input.address.region ?? null, city: input.address.city, street: input.address.street, building: input.address.building, apartment: input.address.apartment ?? null, postalCode: input.address.postalCode ?? null } });
      }
      return created;
    },
    { isolationLevel: 'ReadCommitted', timeout: 20_000 },
  );

  // 2. Платёж — вне транзакции БД (внешний вызов), но идемпотентно
  const provider = getPaymentProvider();
  const paymentKey = `pay_${order.id}`;
  let payment = await db.payment.findUnique({ where: { idempotencyKey: paymentKey } });
  if (!payment) {
    const created = await provider.createPayment({
      orderId: order.id,
      orderPublicId: publicId,
      amountMinor: totals.totalMinor,
      currency: 'RUB',
      description: `Заказ ${publicId} в TechMatch`,
      returnUrl: `${env.APP_URL}/order/${publicId}`,
      customerEmail: input.address.email,
      idempotencyKey: paymentKey,
    });
    payment = await db.payment.create({
      data: { orderId: order.id, provider: provider.code, providerPaymentId: created.providerPaymentId, status: created.status, amountMinor: totals.totalMinor, confirmationUrl: created.confirmationUrl, idempotencyKey: paymentKey, metadata: { mode: provider.mode } },
    });
  }
  try {
    await sendOrderCreated(db, order.id);
  } catch (e) {
    console.warn('[notifications] не удалось отправить письмо о заказе', e);
  }
  return { orderId: order.id, publicId, totalMinor: totals.totalMinor, paymentUrl: payment.confirmationUrl, paymentMode: provider.mode, reused: false };
}

export async function ensureOrderPayable(db: DbClient, orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new NotFoundError('Заказ');
  if (order.status !== 'PENDING_PAYMENT') throw new ConflictError('Заказ не ожидает оплаты');
  return order;
}
