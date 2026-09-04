'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { prisma } from '@techmatch/database';
import { addToCart, applyCoupon, getOrCreateCart, removeCartItem, setActiveDevice, updateCartItem } from '@techmatch/domain';
import { CART_COOKIE, DEVICE_COOKIE, cookieOptions, getCustomer } from '@/lib/session';
import { runAction, type ActionResult } from '@/lib/errors';

async function ensureCart() {
  const jar = await cookies();
  const customer = await getCustomer();
  const { cart, sessionToken } = await getOrCreateCart(prisma, { sessionToken: jar.get(CART_COOKIE)?.value ?? null, customerId: customer?.customer.id ?? null });
  if (jar.get(CART_COOKIE)?.value !== sessionToken) jar.set(CART_COOKIE, sessionToken, cookieOptions(30 * 86_400));
  return cart;
}

export async function addToCartAction(input: { variantId: string; quantity?: number; deviceModelId?: string | null }): Promise<ActionResult<{ itemCount: number }>> {
  return runAction(async () => {
    const cart = await ensureCart();
    await addToCart(prisma, cart.id, input);
    const count = await prisma.cartItem.aggregate({ where: { cartId: cart.id }, _sum: { quantity: true } });
    revalidatePath('/', 'layout');
    return { itemCount: count._sum.quantity ?? 0 };
  });
}

export async function updateCartItemAction(itemId: string, quantity: number): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const cart = await ensureCart();
    await updateCartItem(prisma, cart.id, itemId, quantity);
    revalidatePath('/cart');
    return undefined;
  });
}

export async function removeCartItemAction(itemId: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const cart = await ensureCart();
    await removeCartItem(prisma, cart.id, itemId);
    revalidatePath('/cart');
    return undefined;
  });
}

export async function applyCouponAction(code: string | null): Promise<ActionResult<{ message: string }>> {
  return runAction(async () => {
    const cart = await ensureCart();
    const r = await applyCoupon(prisma, cart.id, code);
    if (!r.ok) throw Object.assign(new Error(r.message), { name: 'DomainError', code: 'COUPON', status: 422 });
    revalidatePath('/cart');
    return { message: r.message };
  });
}

/** Выбор активного устройства (гость — cookie; аккаунт — корзина + cookie). */
export async function setActiveDeviceAction(deviceModelId: string | null): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const jar = await cookies();
    if (deviceModelId) {
      const exists = await prisma.deviceModel.findUnique({ where: { id: deviceModelId }, select: { id: true } });
      if (!exists) throw new Error('Устройство не найдено');
      jar.set(DEVICE_COOKIE, deviceModelId, cookieOptions(180 * 86_400));
    } else jar.delete(DEVICE_COOKIE);
    const cart = await ensureCart();
    await setActiveDevice(prisma, cart.id, deviceModelId);
    revalidatePath('/', 'layout');
    return undefined;
  });
}
