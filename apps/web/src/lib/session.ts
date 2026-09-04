import 'server-only';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { getEnv } from '@techmatch/config';
import { prisma } from '@techmatch/database';
import { resolveAdminSession, resolveCustomerSession, findActiveCart, loadCartDTO, type AdminContext, type CustomerSessionInfo } from '@techmatch/domain';

export const CUSTOMER_COOKIE = 'tm_session';
export const ADMIN_COOKIE = 'tm_admin';
export const CART_COOKIE = 'tm_cart';
export const DEVICE_COOKIE = 'tm_device';

const secure = () => getEnv().NODE_ENV === 'production';

export const cookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: secure(),
  path: '/',
  maxAge: maxAgeSeconds,
});

export const getCustomer = cache(async (): Promise<CustomerSessionInfo | null> => {
  const jar = await cookies();
  return resolveCustomerSession(prisma, jar.get(CUSTOMER_COOKIE)?.value);
});

export const getAdmin = cache(async (): Promise<AdminContext | null> => {
  const jar = await cookies();
  return resolveAdminSession(prisma, jar.get(ADMIN_COOKIE)?.value);
});

/** Активное устройство покупателя: cookie (гость) или primary из аккаунта. */
export const getActiveDeviceId = cache(async (): Promise<string | null> => {
  const jar = await cookies();
  const fromCookie = jar.get(DEVICE_COOKIE)?.value;
  if (fromCookie) return fromCookie;
  const customer = await getCustomer();
  if (!customer) return null;
  const primary = await prisma.customerDevice.findFirst({ where: { customerId: customer.customer.id }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }], select: { deviceModelId: true } });
  return primary?.deviceModelId ?? null;
});

export const getActiveDevice = cache(async () => {
  const id = await getActiveDeviceId();
  if (!id) return null;
  return prisma.deviceModel.findUnique({ where: { id }, select: { id: true, slug: true, name: true, fullName: true, imageUrl: true, brand: { select: { name: true } }, category: { select: { slug: true, name: true } } } });
});

/** Корзина текущего посетителя (только чтение; cookie ставится в server actions). */
export const getCartDTO = cache(async () => {
  const jar = await cookies();
  const token = jar.get(CART_COOKIE)?.value ?? null;
  const customer = await getCustomer();
  if (!token && !customer) return null;
  const cart = await findActiveCart(prisma, { sessionToken: token, customerId: customer?.customer.id ?? null });
  return cart ? loadCartDTO(prisma, cart) : null;
});

export async function requestMeta() {
  const h = await headers();
  return { ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined, userAgent: h.get('user-agent') ?? undefined };
}
