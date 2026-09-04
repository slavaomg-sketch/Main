import type { DbClient, Prisma } from '@techmatch/database';
import { ConflictError, NotFoundError, ValidationError } from '../shared/errors.js';
import { calculateTotals, type Totals } from '../pricing/service.js';
import { availableQuantity } from '../catalog/service.js';
import { validateCoupon } from '../promotions/service.js';
import { randomToken } from '../shared/ids.js';
import { evaluateDeviceCatalog } from '../compatibility/service.js';
import type { CompatibilityResult } from '../compatibility/types.js';

export const cartInclude = {
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      variant: {
        include: {
          product: { include: { images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }], take: 1, include: { asset: true } }, brand: true, category: true } },
          prices: { where: { priceList: 'retail', validFrom: { lte: new Date() }, OR: [{ validTo: null }, { validTo: { gt: new Date() } }] }, orderBy: { validFrom: 'desc' as const }, take: 1 },
          inventory: true,
        },
      },
      addedForDeviceModel: { select: { id: true, name: true, slug: true } },
    },
  },
  activeDeviceModel: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.CartInclude;

export type CartRow = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

export interface CartLineDTO {
  id: string;
  variantId: string;
  productId: string;
  productSlug: string;
  name: string;
  variantName: string;
  sku: string;
  imageUrl: string | null;
  imageVariants: Record<string, string>;
  quantity: number;
  unitPriceMinor: number;
  compareAtMinor: number | null;
  lineTotalMinor: number;
  available: number;
  addedForDevice: { id: string; name: string; slug: string } | null;
  compatibility: Pick<CompatibilityResult, 'status' | 'explanation'> | null;
  weightGrams: number;
}

export interface CartDTO {
  id: string;
  lines: CartLineDTO[];
  itemCount: number;
  totals: Totals;
  couponCode: string | null;
  couponDescription: string | null;
  couponError: string | null;
  activeDevice: { id: string; name: string; slug: string } | null;
  weightGrams: number;
}

export async function getOrCreateCart(db: DbClient, key: { sessionToken?: string | null; customerId?: string | null }): Promise<{ cart: CartRow; sessionToken: string }> {
  let cart: CartRow | null = null;
  if (key.customerId) cart = await db.cart.findFirst({ where: { customerId: key.customerId, status: 'ACTIVE' }, include: cartInclude, orderBy: { updatedAt: 'desc' } });
  if (!cart && key.sessionToken) cart = await db.cart.findFirst({ where: { sessionToken: key.sessionToken, status: 'ACTIVE' }, include: cartInclude });
  if (cart) {
    if (key.customerId && !cart.customerId) cart = await db.cart.update({ where: { id: cart.id }, data: { customerId: key.customerId }, include: cartInclude });
    return { cart, sessionToken: cart.sessionToken ?? key.sessionToken ?? randomToken(24) };
  }
  const sessionToken = key.sessionToken ?? randomToken(24);
  cart = await db.cart.create({ data: { sessionToken, customerId: key.customerId ?? null, expiresAt: new Date(Date.now() + 30 * 86_400_000) }, include: cartInclude });
  return { cart, sessionToken };
}

/** Объединяет гостевую корзину с корзиной пользователя после входа. */
export async function mergeGuestCart(db: DbClient, guestToken: string, customerId: string): Promise<void> {
  const guest = await db.cart.findFirst({ where: { sessionToken: guestToken, status: 'ACTIVE' }, include: { items: true } });
  if (!guest || guest.customerId === customerId) return;
  const own = await db.cart.findFirst({ where: { customerId, status: 'ACTIVE', id: { not: guest.id } }, include: { items: true } });
  if (!own) {
    await db.cart.update({ where: { id: guest.id }, data: { customerId } });
    return;
  }
  for (const item of guest.items) {
    const existing = own.items.find((i) => i.variantId === item.variantId);
    if (existing) await db.cartItem.update({ where: { id: existing.id }, data: { quantity: existing.quantity + item.quantity } });
    else await db.cartItem.create({ data: { cartId: own.id, variantId: item.variantId, quantity: item.quantity, addedForDeviceModelId: item.addedForDeviceModelId } });
  }
  await db.cart.update({ where: { id: guest.id }, data: { status: 'ABANDONED' } });
  if (!own.activeDeviceModelId && guest.activeDeviceModelId) await db.cart.update({ where: { id: own.id }, data: { activeDeviceModelId: guest.activeDeviceModelId } });
}

export async function addToCart(db: DbClient, cartId: string, input: { variantId: string; quantity?: number; deviceModelId?: string | null }): Promise<void> {
  const qty = Math.max(1, Math.min(99, input.quantity ?? 1));
  const variant = await db.productVariant.findUnique({ where: { id: input.variantId }, include: { inventory: true, product: { select: { status: true } } } });
  if (!variant || variant.status !== 'ACTIVE' || variant.product.status !== 'ACTIVE') throw new NotFoundError('Товар', input.variantId);
  const existing = await db.cartItem.findUnique({ where: { cartId_variantId: { cartId, variantId: input.variantId } } });
  const target = (existing?.quantity ?? 0) + qty;
  const available = availableQuantity(variant.inventory);
  if (target > available) throw new ConflictError(available > 0 ? `В наличии только ${available} шт.` : 'Товара нет в наличии', { available });
  if (existing) await db.cartItem.update({ where: { id: existing.id }, data: { quantity: target, addedForDeviceModelId: input.deviceModelId ?? existing.addedForDeviceModelId } });
  else await db.cartItem.create({ data: { cartId, variantId: input.variantId, quantity: qty, addedForDeviceModelId: input.deviceModelId ?? null } });
  await db.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
}

export async function updateCartItem(db: DbClient, cartId: string, itemId: string, quantity: number): Promise<void> {
  const item = await db.cartItem.findFirst({ where: { id: itemId, cartId }, include: { variant: { include: { inventory: true } } } });
  if (!item) throw new NotFoundError('Позиция корзины', itemId);
  if (quantity <= 0) {
    await db.cartItem.delete({ where: { id: item.id } });
    return;
  }
  const available = availableQuantity(item.variant.inventory);
  if (quantity > available) throw new ConflictError(`В наличии только ${available} шт.`, { available });
  await db.cartItem.update({ where: { id: item.id }, data: { quantity: Math.min(99, quantity) } });
}

export async function removeCartItem(db: DbClient, cartId: string, itemId: string): Promise<void> {
  await db.cartItem.deleteMany({ where: { id: itemId, cartId } });
}

export async function applyCoupon(db: DbClient, cartId: string, code: string | null): Promise<{ ok: boolean; message: string }> {
  if (!code) {
    await db.cart.update({ where: { id: cartId }, data: { couponCode: null } });
    return { ok: true, message: 'Промокод удалён' };
  }
  const cart = await db.cart.findUnique({ where: { id: cartId }, include: cartInclude });
  if (!cart) throw new NotFoundError('Корзина');
  const dto = buildCartDTO(cart);
  const check = await validateCoupon(db, code, { subtotalMinor: dto.totals.subtotalMinor, customerId: cart.customerId });
  if (!check.valid) return { ok: false, message: check.reason ?? 'Промокод не подходит' };
  await db.cart.update({ where: { id: cartId }, data: { couponCode: check.coupon!.code } });
  return { ok: true, message: `${check.coupon!.description} применена` };
}

export async function setActiveDevice(db: DbClient, cartId: string, deviceModelId: string | null): Promise<void> {
  await db.cart.update({ where: { id: cartId }, data: { activeDeviceModelId: deviceModelId } });
}

export function buildCartDTO(cart: CartRow, opts: { couponRule?: { rule: { type: 'PERCENT' | 'FIXED'; value: number; minSubtotalMinor?: number; maxDiscountMinor?: number | null }; description: string } | null; couponError?: string | null; compat?: Map<string, CompatibilityResult> | null } = {}): CartDTO {
  const lines: CartLineDTO[] = cart.items
    .filter((i) => i.variant.prices.length > 0)
    .map((i) => {
      const price = i.variant.prices[0]!;
      const img = i.variant.product.images[0];
      const compat = opts.compat?.get(i.variant.productId) ?? null;
      return {
        id: i.id,
        variantId: i.variantId,
        productId: i.variant.productId,
        productSlug: i.variant.product.slug,
        name: i.variant.product.name,
        variantName: i.variant.name,
        sku: i.variant.sku,
        imageUrl: img?.asset.publicUrl ?? null,
        imageVariants: (img?.asset.variants as Record<string, string>) ?? {},
        quantity: i.quantity,
        unitPriceMinor: price.amountMinor,
        compareAtMinor: price.compareAtMinor,
        lineTotalMinor: price.amountMinor * i.quantity,
        available: availableQuantity(i.variant.inventory),
        addedForDevice: i.addedForDeviceModel,
        compatibility: compat ? { status: compat.status, explanation: compat.explanation } : null,
        weightGrams: i.variant.weightGrams ?? 150,
      };
    });
  const totals = calculateTotals(
    lines.map((l) => ({ variantId: l.variantId, productId: l.productId, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor })),
    { discount: opts.couponRule?.rule ?? null },
  );
  return {
    id: cart.id,
    lines,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    totals,
    couponCode: cart.couponCode,
    couponDescription: opts.couponRule?.description ?? null,
    couponError: opts.couponError ?? null,
    activeDevice: cart.activeDeviceModel,
    weightGrams: lines.reduce((s, l) => s + l.weightGrams * l.quantity, 0),
  };
}

/** Полная DTO корзины с проверкой промокода и совместимостью с активным устройством. */
export async function loadCartDTO(db: DbClient, cart: CartRow): Promise<CartDTO> {
  let couponRule: Parameters<typeof buildCartDTO>[1] extends infer O ? (O extends { couponRule?: infer R } ? R : never) : never = null;
  let couponError: string | null = null;
  const base = buildCartDTO(cart);
  if (cart.couponCode) {
    const check = await validateCoupon(db, cart.couponCode, { subtotalMinor: base.totals.subtotalMinor, customerId: cart.customerId });
    if (check.valid) couponRule = { rule: check.coupon!.rule, description: check.coupon!.description };
    else couponError = check.reason ?? null;
  }
  let compat: Map<string, CompatibilityResult> | null = null;
  if (cart.activeDeviceModelId && cart.items.length) {
    try {
      compat = (await evaluateDeviceCatalog(db, cart.activeDeviceModelId)).results;
    } catch {
      compat = null;
    }
  }
  return buildCartDTO(cart, { couponRule, couponError, compat });
}

export function assertCartReady(dto: CartDTO): void {
  if (dto.lines.length === 0) throw new ValidationError('Корзина пуста');
  const short = dto.lines.filter((l) => l.available < l.quantity);
  if (short.length) throw new ConflictError(`Недостаточно на складе: ${short.map((l) => `${l.name} (доступно ${l.available})`).join(', ')}`);
}
