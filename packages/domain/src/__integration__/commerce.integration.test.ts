import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MockPaymentProvider } from '@techmatch/integrations';
import { charger30, freshDb, iphone15pro, prisma, usbcCable } from './fixtures';
import { addToCart, applyCoupon, getOrCreateCart, loadCartDTO } from '../cart/service';
import { createOrderFromCart } from '../checkout/service';
import { expireUnpaidOrders, transitionOrder } from '../orders/service';
import { handlePaymentWebhook } from '../payments/service';
import { getPaymentProvider, overrideProviders } from '../providers';
import { ConflictError } from '../shared/errors';

const address = { fullName: 'Тест Тестов', phone: '+79000000000', email: 'test@example.com', city: 'Москва', street: 'Ленина', building: '1' };

describe('корзина, заказ, оплата (интеграция)', () => {
  let f: Awaited<ReturnType<typeof freshDb>>;
  beforeEach(async () => {
    f = await freshDb();
    overrideProviders({ payment: new MockPaymentProvider({ appUrl: 'http://localhost:3000', webhookSecret: 'test-secret' }) });
  });

  it('корзина: добавление, лимит остатка, промокод и итоги', async () => {
    const { variant } = await usbcCable(f, 2);
    const { cart, sessionToken } = await getOrCreateCart(prisma, { sessionToken: null });
    await addToCart(prisma, cart.id, { variantId: variant.id, quantity: 2 });
    await expect(addToCart(prisma, cart.id, { variantId: variant.id, quantity: 1 })).rejects.toBeInstanceOf(ConflictError);
    await prisma.coupon.create({ data: { code: 'TEN', discountType: 'PERCENT', value: 10 } });
    expect((await applyCoupon(prisma, cart.id, 'ten')).ok).toBe(true);
    const again = await getOrCreateCart(prisma, { sessionToken });
    const dto = await loadCartDTO(prisma, again.cart);
    expect(dto.itemCount).toBe(2);
    expect(dto.totals.subtotalMinor).toBe(298000);
    expect(dto.totals.discountMinor).toBe(29800);
    expect(dto.totals.totalMinor).toBe(268200);
  });

  it('заказ: транзакционное создание, резерв, идемпотентность, оплата через webhook, повтор webhook, истечение резерва', async () => {
    const device = await iphone15pro(f);
    const { variant } = await charger30(f, 3);
    const { cart } = await getOrCreateCart(prisma, { sessionToken: null });
    await prisma.cart.update({ where: { id: cart.id }, data: { activeDeviceModelId: device.id } });
    await addToCart(prisma, cart.id, { variantId: variant.id, quantity: 2 });
    const key = randomUUID();
    const result = await createOrderFromCart(prisma, { cartId: cart.id, address, deliveryMethodCode: 'courier', idempotencyKey: key });
    expect(result.reused).toBe(false);
    expect(result.paymentMode).toBe('mock');
    expect(result.paymentUrl).toContain('/mock-payment/');
    const order = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId }, include: { items: true, payments: true } });
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.items[0]?.compatibilityStatus).toBe('COMPATIBLE');
    expect(order.subtotalMinor).toBe(398000);
    expect(order.totalMinor).toBe(398000); // бесплатная доставка от 3000 ₽
    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv).toMatchObject({ quantity: 3, reservedQuantity: 2 });

    // идемпотентность: тот же ключ → тот же заказ
    const repeat = await createOrderFromCart(prisma, { cartId: cart.id, address, deliveryMethodCode: 'courier', idempotencyKey: key });
    expect(repeat.reused).toBe(true);
    expect(repeat.orderId).toBe(result.orderId);
    expect(await prisma.order.count()).toBe(1);

    // webhook оплаты
    const provider = getPaymentProvider() as MockPaymentProvider;
    const paymentId = order.payments[0]!.providerPaymentId!;
    const body = JSON.stringify({ eventId: 'evt-1', paymentId, event: 'succeeded', amountMinor: order.totalMinor });
    const bad = await handlePaymentWebhook(prisma, { headers: { 'x-mock-signature': 'deadbeef' }, rawBody: body });
    expect(bad.accepted).toBe(false);
    const ok = await handlePaymentWebhook(prisma, { headers: { 'x-mock-signature': provider.sign(body) }, rawBody: body });
    expect(ok).toMatchObject({ accepted: true, duplicate: false });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
    const afterPay = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(afterPay).toMatchObject({ quantity: 1, reservedQuantity: 0 });

    // повторный webhook — без побочных эффектов
    const dup = await handlePaymentWebhook(prisma, { headers: { 'x-mock-signature': provider.sign(body) }, rawBody: body });
    expect(dup.duplicate).toBe(true);
    expect(await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).toMatchObject({ quantity: 1, reservedQuantity: 0 });
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, toStatus: 'PAID' } })).toBe(1);

    // конечный автомат: PAID → SHIPPED недопустим
    await expect(transitionOrder(prisma, { orderId: order.id, to: 'SHIPPED', actorType: 'ADMIN' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('неуспешная оплата и истечение резерва', async () => {
    const { variant } = await charger30(f, 1);
    const { cart } = await getOrCreateCart(prisma, { sessionToken: null });
    await addToCart(prisma, cart.id, { variantId: variant.id, quantity: 1 });
    const r = await createOrderFromCart(prisma, { cartId: cart.id, address, deliveryMethodCode: 'pickup', idempotencyKey: randomUUID() });
    const provider = getPaymentProvider() as MockPaymentProvider;
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: r.orderId } });
    const body = JSON.stringify({ eventId: 'evt-fail', paymentId: payment.providerPaymentId, event: 'canceled' });
    await handlePaymentWebhook(prisma, { headers: { 'x-mock-signature': provider.sign(body) }, rawBody: body });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('FAILED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } })).status).toBe('PENDING_PAYMENT');
    // второй покупатель не может купить последнюю единицу, пока держится резерв
    const { cart: cart2 } = await getOrCreateCart(prisma, { sessionToken: null });
    await expect(addToCart(prisma, cart2.id, { variantId: variant.id, quantity: 1 })).rejects.toBeInstanceOf(ConflictError);
    // истечение резерва
    await prisma.order.update({ where: { id: r.orderId }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    expect(await expireUnpaidOrders(prisma)).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } })).status).toBe('CANCELLED');
    expect(await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).toMatchObject({ quantity: 1, reservedQuantity: 0 });
    await addToCart(prisma, cart2.id, { variantId: variant.id, quantity: 1 });
  });
});
