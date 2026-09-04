'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@techmatch/database';
import { createOrderFromCart, createRetryPayment, getOrCreateCart, loadCartDTO, quoteDelivery } from '@techmatch/domain';
import { getEnv } from '@techmatch/config';
import { CART_COOKIE, getCustomer, requestMeta } from '@/lib/session';
import { rateLimit } from '@/lib/rate-limit';
import { runAction, toActionError, type ActionResult } from '@/lib/errors';

const addressSchema = z.object({
  fullName: z.string().trim().min(2, 'Укажите имя и фамилию').max(120),
  phone: z.string().trim().min(10, 'Укажите телефон').max(30),
  email: z.email('Укажите корректный email'),
  city: z.string().trim().min(2, 'Укажите город').max(100),
  street: z.string().trim().min(2, 'Укажите улицу').max(160),
  building: z.string().trim().min(1, 'Укажите дом').max(30),
  apartment: z.string().trim().max(30).optional().or(z.literal('')),
  postalCode: z.string().trim().max(12).optional().or(z.literal('')),
  region: z.string().trim().max(100).optional().or(z.literal('')),
});

export type CheckoutFormState = ActionResult<{ publicId: string; paymentUrl: string | null }> | null;

export async function quoteDeliveryAction(city: string): Promise<ActionResult<Array<{ methodCode: string; name: string; description: string; costMinor: number }>>> {
  return runAction(async () => {
    const jar = await cookies();
    const customer = await getCustomer();
    const { cart } = await getOrCreateCart(prisma, { sessionToken: jar.get(CART_COOKIE)?.value ?? null, customerId: customer?.customer.id ?? null });
    const dto = await loadCartDTO(prisma, cart);
    const quotes = await quoteDelivery(dto, { city: city || 'Москва' });
    return quotes.map((q) => ({ methodCode: q.methodCode, name: q.name, description: q.description, costMinor: q.costMinor }));
  });
}

export async function placeOrderAction(_prev: CheckoutFormState, formData: FormData): Promise<CheckoutFormState> {
  const parsed = addressSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  const deliveryMethodCode = String(formData.get('deliveryMethodCode') ?? '');
  const idempotencyKey = String(formData.get('idempotencyKey') ?? '');
  if (!deliveryMethodCode) return { ok: false, error: 'Выберите способ доставки' };
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(idempotencyKey)) return { ok: false, error: 'Некорректный ключ заказа, обновите страницу' };
  const meta = await requestMeta();
  const rl = await rateLimit(`checkout:${meta.ip ?? 'anon'}`, { max: 10, windowSeconds: 600 });
  if (!rl.ok) return { ok: false, error: 'Слишком много попыток оформления. Подождите немного.' };
  let target = '';
  try {
    const jar = await cookies();
    const customer = await getCustomer();
    const { cart } = await getOrCreateCart(prisma, { sessionToken: jar.get(CART_COOKIE)?.value ?? null, customerId: customer?.customer.id ?? null });
    const result = await createOrderFromCart(prisma, {
      cartId: cart.id,
      customerId: customer?.customer.id ?? null,
      address: { ...parsed.data, apartment: parsed.data.apartment || null, postalCode: parsed.data.postalCode || null, region: parsed.data.region || null },
      deliveryMethodCode,
      comment: String(formData.get('comment') ?? '').slice(0, 500) || null,
      idempotencyKey,
      saveAddress: Boolean(customer) && formData.get('saveAddress') === 'on',
    });
    target = result.paymentUrl ?? `/order/${result.publicId}`;
  } catch (e) {
    return toActionError(e);
  }
  redirect(target);
}

export async function retryPaymentAction(orderId: string): Promise<ActionResult<{ url: string | null }>> {
  return runAction(async () => {
    const p = await createRetryPayment(prisma, orderId, getEnv().APP_URL);
    return { url: p?.confirmationUrl ?? null };
  });
}
