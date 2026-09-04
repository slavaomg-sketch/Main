import { assertMinor, percentOf, type Minor } from '../shared/money';

function assertMinorValue(v: number) {
  assertMinor(v, 'promotionDiscountMinor');
}

export interface PricedLine {
  variantId: string;
  productId: string;
  quantity: number;
  unitPriceMinor: Minor;
  compareAtMinor?: Minor | null;
}

export interface DiscountRule {
  type: 'PERCENT' | 'FIXED';
  value: number; // проценты или копейки
  minSubtotalMinor?: number;
  maxDiscountMinor?: number | null;
}

export interface Totals {
  subtotalMinor: Minor;
  /** Скидка по промокоду */
  discountMinor: Minor;
  /** Скидка за комплекты и акции (без промокода) */
  promotionDiscountMinor: Minor;
  deliveryMinor: Minor;
  totalMinor: Minor;
  lines: Array<PricedLine & { lineTotalMinor: Minor }>;
}

/** Расчёт итогов корзины/заказа. Только целые копейки, без float. */
export function calculateTotals(lines: PricedLine[], opts: { discount?: DiscountRule | null; deliveryMinor?: Minor; promotionDiscountMinor?: Minor } = {}): Totals {
  const priced = lines.map((l) => {
    if (!Number.isInteger(l.unitPriceMinor) || !Number.isInteger(l.quantity) || l.quantity <= 0) {
      throw new TypeError('Некорректная строка расчёта');
    }
    return { ...l, lineTotalMinor: l.unitPriceMinor * l.quantity };
  });
  const subtotalMinor = priced.reduce((s, l) => s + l.lineTotalMinor, 0);
  const promotionDiscountMinor = Math.min(subtotalMinor, opts.promotionDiscountMinor ?? 0);
  assertMinorValue(promotionDiscountMinor);
  const discountMinor = calculateDiscount(subtotalMinor - promotionDiscountMinor, opts.discount ?? null);
  const deliveryMinor = opts.deliveryMinor ?? 0;
  const totalMinor = Math.max(0, subtotalMinor - promotionDiscountMinor - discountMinor) + deliveryMinor;
  return { subtotalMinor, discountMinor, promotionDiscountMinor, deliveryMinor, totalMinor, lines: priced };
}

export function calculateDiscount(subtotalMinor: Minor, rule: DiscountRule | null): Minor {
  if (!rule) return 0;
  if (rule.minSubtotalMinor && subtotalMinor < rule.minSubtotalMinor) return 0;
  let discount = rule.type === 'PERCENT' ? percentOf(subtotalMinor, rule.value) : rule.value;
  if (rule.maxDiscountMinor != null) discount = Math.min(discount, rule.maxDiscountMinor);
  return Math.min(discount, subtotalMinor);
}

/** Цена комплекта: сумма позиций минус скидка комплекта или фиксированная цена. */
export function calculateBundlePrice(items: Array<{ unitPriceMinor: Minor; quantity: number }>, bundle: { discountPercent: number; fixedPriceMinor?: number | null }): { regularMinor: Minor; bundleMinor: Minor; savingsMinor: Minor } {
  const regularMinor = items.reduce((s, i) => s + i.unitPriceMinor * i.quantity, 0);
  const bundleMinor = bundle.fixedPriceMinor != null ? bundle.fixedPriceMinor : regularMinor - percentOf(regularMinor, bundle.discountPercent);
  return { regularMinor, bundleMinor, savingsMinor: Math.max(0, regularMinor - bundleMinor) };
}

export function discountPercent(priceMinor: Minor, compareAtMinor: Minor | null | undefined): number | null {
  if (!compareAtMinor || compareAtMinor <= priceMinor) return null;
  return Math.round(((compareAtMinor - priceMinor) / compareAtMinor) * 100);
}

/**
 * Скидка за полные комплекты в корзине: если все позиции комплекта присутствуют в нужном количестве,
 * на них действует discountPercent комплекта. Один товар учитывается только в одном комплекте.
 */
export function calculateBundleDiscounts(
  lines: Array<{ variantId: string; quantity: number; unitPriceMinor: Minor }>,
  bundles: Array<{ id: string; name: string; discountPercent: number; items: Array<{ variantId: string; quantity: number }> }>,
): { totalMinor: Minor; applied: Array<{ bundleId: string; name: string; discountMinor: Minor }> } {
  const remaining = new Map(lines.map((l) => [l.variantId, l.quantity]));
  const price = new Map(lines.map((l) => [l.variantId, l.unitPriceMinor]));
  const applied: Array<{ bundleId: string; name: string; discountMinor: Minor }> = [];
  for (const b of [...bundles].sort((a, c) => c.discountPercent - a.discountPercent)) {
    if (b.discountPercent <= 0 || b.items.length === 0) continue;
    // сколько полных комплектов можно собрать
    const sets = Math.min(...b.items.map((i) => Math.floor((remaining.get(i.variantId) ?? 0) / i.quantity)));
    if (!Number.isFinite(sets) || sets <= 0) continue;
    let base = 0;
    for (const i of b.items) {
      base += (price.get(i.variantId) ?? 0) * i.quantity * sets;
      remaining.set(i.variantId, (remaining.get(i.variantId) ?? 0) - i.quantity * sets);
    }
    const discountMinor = percentOf(base, b.discountPercent);
    if (discountMinor > 0) applied.push({ bundleId: b.id, name: b.name, discountMinor });
  }
  return { totalMinor: applied.reduce((s, a) => s + a.discountMinor, 0), applied };
}
