'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@techmatch/database';
import { addCustomerDevice, cancelOrderByCustomer, changePassword, loginCustomer, logoutCustomer, mergeGuestDevices, mergeGuestFavorites, registerCustomer, removeCustomerDevice, setPrimaryDevice, updateCustomerProfile } from '@techmatch/domain';
import { CART_COOKIE, CUSTOMER_COOKIE, DEVICE_COOKIE, cookieOptions, getCustomer, requestMeta } from '@/lib/session';
import { FAV_COOKIE, getGuestFavoriteIds } from '@/lib/favorites';
import { rateLimit } from '@/lib/rate-limit';
import { runAction, toActionError, type ActionResult } from '@/lib/errors';

const loginSchema = z.object({ email: z.email('Укажите корректный email'), password: z.string().min(1, 'Введите пароль'), next: z.string().optional() });
const registerSchema = z.object({ email: z.email('Укажите корректный email'), password: z.string().min(8, 'Пароль не короче 8 символов'), firstName: z.string().min(1, 'Укажите имя').max(60), phone: z.string().max(30).optional(), next: z.string().optional() });

function safeNext(next: string | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

async function afterLogin(token: string, customerId: string) {
  const jar = await cookies();
  jar.set(CUSTOMER_COOKIE, token, cookieOptions(30 * 86_400));
  // Объединение гостевых данных: устройство и избранное
  const guestDevice = jar.get(DEVICE_COOKIE)?.value;
  if (guestDevice) await mergeGuestDevices(prisma, customerId, [{ deviceModelId: guestDevice }]);
  const favs = await getGuestFavoriteIds();
  if (favs.length) {
    await mergeGuestFavorites(prisma, customerId, favs);
    jar.delete(FAV_COOKIE);
  }
}

export async function loginAction(_prev: ActionResult<undefined> | null, formData: FormData): Promise<ActionResult<undefined>> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  const meta = await requestMeta();
  const rl = await rateLimit(`login:${meta.ip ?? 'anon'}`, { max: 10, windowSeconds: 300 });
  if (!rl.ok) return { ok: false, error: 'Слишком много попыток входа. Подождите 5 минут.' };
  try {
    const jar = await cookies();
    const { token, customer } = await loginCustomer(prisma, { email: parsed.data.email, password: parsed.data.password, ...meta, guestCartToken: jar.get(CART_COOKIE)?.value ?? null });
    await afterLogin(token, customer.id);
  } catch (e) {
    return toActionError(e);
  }
  redirect(safeNext(parsed.data.next));
}

export async function registerAction(_prev: ActionResult<undefined> | null, formData: FormData): Promise<ActionResult<undefined>> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  const meta = await requestMeta();
  const rl = await rateLimit(`register:${meta.ip ?? 'anon'}`, { max: 5, windowSeconds: 600 });
  if (!rl.ok) return { ok: false, error: 'Слишком много попыток. Попробуйте позже.' };
  try {
    await registerCustomer(prisma, { email: parsed.data.email, password: parsed.data.password, firstName: parsed.data.firstName, phone: parsed.data.phone });
    const jar = await cookies();
    const { token, customer } = await loginCustomer(prisma, { email: parsed.data.email, password: parsed.data.password, ...meta, guestCartToken: jar.get(CART_COOKIE)?.value ?? null });
    await afterLogin(token, customer.id);
  } catch (e) {
    return toActionError(e);
  }
  redirect(safeNext(parsed.data.next));
}

export async function logoutAction() {
  const jar = await cookies();
  await logoutCustomer(prisma, jar.get(CUSTOMER_COOKIE)?.value);
  jar.delete(CUSTOMER_COOKIE);
  jar.delete(DEVICE_COOKIE);
  redirect('/');
}

export async function saveDeviceAction(input: { deviceModelId: string; deviceVariantId?: string | null; makePrimary?: boolean }): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const customer = await getCustomer();
    if (!customer) return undefined;
    await addCustomerDevice(prisma, customer.customer.id, input);
    revalidatePath('/account/devices');
    return undefined;
  });
}

export async function removeDeviceAction(id: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const customer = await getCustomer();
    if (!customer) throw new Error('Требуется вход');
    await removeCustomerDevice(prisma, customer.customer.id, id);
    revalidatePath('/account/devices');
    return undefined;
  });
}

export async function setPrimaryDeviceAction(id: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const customer = await getCustomer();
    if (!customer) throw new Error('Требуется вход');
    await setPrimaryDevice(prisma, customer.customer.id, id);
    const d = await prisma.customerDevice.findUnique({ where: { id } });
    if (d) (await cookies()).set(DEVICE_COOKIE, d.deviceModelId, cookieOptions(180 * 86_400));
    revalidatePath('/', 'layout');
    return undefined;
  });
}

const profileSchema = z.object({ firstName: z.string().max(60).optional(), lastName: z.string().max(60).optional(), phone: z.string().max(30).optional(), marketingOptIn: z.string().optional() });

export async function updateProfileAction(_prev: ActionResult<{ message: string }> | null, formData: FormData): Promise<ActionResult<{ message: string }>> {
  const customer = await getCustomer();
  if (!customer) return { ok: false, error: 'Требуется вход' };
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: 'Проверьте данные' };
  await updateCustomerProfile(prisma, customer.customer.id, { firstName: parsed.data.firstName || null, lastName: parsed.data.lastName || null, phone: parsed.data.phone || null, marketingOptIn: parsed.data.marketingOptIn === 'on' });
  revalidatePath('/account');
  return { ok: true, data: { message: 'Профиль сохранён' } };
}

export async function changePasswordAction(_prev: ActionResult<{ message: string }> | null, formData: FormData): Promise<ActionResult<{ message: string }>> {
  const customer = await getCustomer();
  if (!customer) return { ok: false, error: 'Требуется вход' };
  try {
    await changePassword(prisma, customer.customer.id, { current: String(formData.get('current') ?? ''), next: String(formData.get('next') ?? '') });
    return { ok: true, data: { message: 'Пароль изменён' } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function cancelOrderAction(orderId: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const customer = await getCustomer();
    if (!customer) throw new Error('Требуется вход');
    await cancelOrderByCustomer(prisma, { orderId, customerId: customer.customer.id });
    revalidatePath('/account/orders');
    return undefined;
  });
}
