import { percentOf, type Minor } from '../shared/money.js';

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
  discountMinor: Minor;
  deliveryMinor: Minor;
  totalMinor: Minor;
  lines: Array<PricedLine & { lineTotalMinor: Minor }>;
}

/** Расчёт итогов корзины/заказа. Только целые копейки, без float. */
export function calculateTotals(lines: PricedLine[], opts: { discount?: DiscountRule | null; deliveryMinor?: Minor } = {}): Totals {
  const priced = lines.map((l) => {
    if (!Number.isInteger(l.unitPriceMinor) || !Number.isInteger(l.quantity) || l.quantity <= 0) {
      throw new TypeError('Некорректная строка расчёта');
    }
    return { ...l, lineTotalMinor: l.unitPriceMinor * l.quantity };
  });
  const subtotalMinor = priced.reduce((s, l) => s + l.lineTotalMinor, 0);
  const discountMinor = calculateDiscount(subtotalMinor, opts.discount ?? null);
  const deliveryMinor = opts.deliveryMinor ?? 0;
  const totalMinor = Math.max(0, subtotalMinor - discountMinor) + deliveryMinor;
  return { subtotalMinor, discountMinor, deliveryMinor, totalMinor, lines: priced };
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
