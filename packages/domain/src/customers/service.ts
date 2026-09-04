import { getEnv } from '@techmatch/config';
import type { DbClient, PrismaClient } from '@techmatch/database';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../shared/errors';
import { hashPassword, sha256, verifyPassword } from '../shared/password';
import { randomToken } from '../shared/ids';
import { mergeGuestCart } from '../cart/service';

export interface CustomerSessionInfo {
  customer: { id: string; email: string; firstName: string | null; lastName: string | null; phone: string | null };
  sessionId: string;
}

export async function registerCustomer(db: PrismaClient, input: { email: string; password: string; firstName?: string; lastName?: string; phone?: string; marketingOptIn?: boolean }) {
  const email = input.email.trim().toLowerCase();
  if (input.password.length < 8) throw new ValidationError('Пароль должен быть не короче 8 символов');
  const exists = await db.customer.findUnique({ where: { email } });
  if (exists?.passwordHash) throw new ConflictError('Пользователь с таким email уже зарегистрирован');
  const data = { passwordHash: hashPassword(input.password), firstName: input.firstName ?? null, lastName: input.lastName ?? null, phone: input.phone ?? null, marketingOptIn: input.marketingOptIn ?? false };
  return exists ? db.customer.update({ where: { id: exists.id }, data }) : db.customer.create({ data: { email, ...data } });
}

export async function loginCustomer(db: PrismaClient, input: { email: string; password: string; userAgent?: string; ip?: string; guestCartToken?: string | null; guestDevices?: Array<{ deviceModelId: string; deviceVariantId?: string | null }> }) {
  const email = input.email.trim().toLowerCase();
  const customer = await db.customer.findUnique({ where: { email } });
  if (!customer?.passwordHash || !verifyPassword(input.password, customer.passwordHash)) throw new UnauthorizedError('Неверный email или пароль');
  const token = randomToken(32);
  const ttlDays = getEnv().CUSTOMER_SESSION_TTL_DAYS;
  await db.customerSession.create({ data: { customerId: customer.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlDays * 86_400_000), userAgent: input.userAgent?.slice(0, 200) ?? null, ip: input.ip ?? null } });
  await db.customer.update({ where: { id: customer.id }, data: { lastLoginAt: new Date() } });
  if (input.guestCartToken) await mergeGuestCart(db, input.guestCartToken, customer.id);
  return { token, customer };
}

export async function resolveCustomerSession(db: DbClient, token: string | undefined | null): Promise<CustomerSessionInfo | null> {
  if (!token) return null;
  const session = await db.customerSession.findUnique({ where: { tokenHash: sha256(token) }, include: { customer: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } } } });
  if (!session || session.expiresAt < new Date()) return null;
  return { customer: session.customer, sessionId: session.id };
}

export async function logoutCustomer(db: DbClient, token: string | undefined | null) {
  if (!token) return;
  await db.customerSession.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function updateCustomerProfile(db: DbClient, customerId: string, input: { firstName?: string | null; lastName?: string | null; phone?: string | null; marketingOptIn?: boolean }) {
  return db.customer.update({ where: { id: customerId }, data: input });
}

export async function changePassword(db: DbClient, customerId: string, input: { current: string; next: string }) {
  const c = await db.customer.findUnique({ where: { id: customerId } });
  if (!c?.passwordHash || !verifyPassword(input.current, c.passwordHash)) throw new UnauthorizedError('Текущий пароль неверен');
  if (input.next.length < 8) throw new ValidationError('Пароль должен быть не короче 8 символов');
  await db.customer.update({ where: { id: customerId }, data: { passwordHash: hashPassword(input.next) } });
}

// ---------- Мои устройства ----------

export async function listCustomerDevices(db: DbClient, customerId: string) {
  return db.customerDevice.findMany({
    where: { customerId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    include: { deviceModel: { include: { brand: true, category: true } }, deviceVariant: true },
  });
}

export async function addCustomerDevice(db: DbClient, customerId: string, input: { deviceModelId: string; deviceVariantId?: string | null; nickname?: string | null; makePrimary?: boolean }) {
  const model = await db.deviceModel.findUnique({ where: { id: input.deviceModelId } });
  if (!model) throw new NotFoundError('Устройство');
  const scopeKey = input.deviceVariantId ?? '*';
  const count = await db.customerDevice.count({ where: { customerId } });
  const row = await db.customerDevice.upsert({
    where: { customerId_deviceModelId_scopeKey: { customerId, deviceModelId: input.deviceModelId, scopeKey } },
    create: { customerId, deviceModelId: input.deviceModelId, deviceVariantId: input.deviceVariantId ?? null, scopeKey, nickname: input.nickname ?? null, isPrimary: input.makePrimary || count === 0 },
    update: { nickname: input.nickname ?? undefined },
  });
  if (input.makePrimary) await setPrimaryDevice(db, customerId, row.id);
  return row;
}

export async function setPrimaryDevice(db: DbClient, customerId: string, id: string) {
  await db.customerDevice.updateMany({ where: { customerId }, data: { isPrimary: false } });
  await db.customerDevice.updateMany({ where: { customerId, id }, data: { isPrimary: true } });
}

export async function removeCustomerDevice(db: DbClient, customerId: string, id: string) {
  await db.customerDevice.deleteMany({ where: { customerId, id } });
}

/** Объединение локально сохранённых устройств гостя с аккаунтом после входа. */
export async function mergeGuestDevices(db: DbClient, customerId: string, devices: Array<{ deviceModelId: string; deviceVariantId?: string | null }>) {
  let added = 0;
  for (const d of devices) {
    try {
      await addCustomerDevice(db, customerId, d);
      added += 1;
    } catch {
      // неизвестные id пропускаем
    }
  }
  return added;
}

// ---------- Избранное ----------

export async function listFavorites(db: DbClient, customerId: string) {
  const rows = await db.favorite.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
  return rows.map((r) => r.productId);
}

export async function toggleFavorite(db: DbClient, customerId: string, productId: string): Promise<boolean> {
  const existing = await db.favorite.findUnique({ where: { customerId_productId: { customerId, productId } } });
  if (existing) {
    await db.favorite.delete({ where: { id: existing.id } });
    return false;
  }
  await db.favorite.create({ data: { customerId, productId } });
  return true;
}

export async function mergeGuestFavorites(db: DbClient, customerId: string, productIds: string[]) {
  for (const productId of productIds) {
    await db.favorite.upsert({ where: { customerId_productId: { customerId, productId } }, create: { customerId, productId }, update: {} }).catch(() => undefined);
  }
}

// ---------- Адреса ----------

export async function listAddresses(db: DbClient, customerId: string) {
  return db.address.findMany({ where: { customerId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
}

// ---------- Админка: клиенты ----------

export async function listCustomersForAdmin(db: DbClient, opts: { query?: string | null; page?: number; perPage?: number }) {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(100, opts.perPage ?? 25);
  const where = opts.query ? { OR: [{ email: { contains: opts.query, mode: 'insensitive' as const } }, { firstName: { contains: opts.query, mode: 'insensitive' as const } }, { lastName: { contains: opts.query, mode: 'insensitive' as const } }, { phone: { contains: opts.query } }] } : {};
  const [items, total] = await Promise.all([
    db.customer.findMany({ where, select: { id: true, email: true, firstName: true, lastName: true, phone: true, createdAt: true, lastLoginAt: true, _count: { select: { orders: true, devices: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
    db.customer.count({ where }),
  ]);
  return { items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
}

export async function getCustomerForAdmin(db: DbClient, id: string) {
  const c = await db.customer.findUnique({
    where: { id },
    select: {
      id: true, email: true, firstName: true, lastName: true, phone: true, createdAt: true, lastLoginAt: true, marketingOptIn: true,
      orders: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, publicId: true, status: true, totalMinor: true, createdAt: true } },
      devices: { include: { deviceModel: { select: { name: true, slug: true } } } },
      addresses: { select: { id: true, city: true, street: true, building: true, isDefault: true } },
    },
  });
  if (!c) throw new NotFoundError('Клиент', id);
  return c;
}
