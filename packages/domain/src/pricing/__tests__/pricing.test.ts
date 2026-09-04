import { describe, expect, it } from 'vitest';
import { calculateBundlePrice, calculateDiscount, calculateTotals, discountPercent } from '../service.js';
import { formatRub, percentOf } from '../../shared/money.js';

describe('pricing', () => {
  it('итоги без скидки', () => {
    const t = calculateTotals([{ variantId: 'a', productId: 'p', quantity: 2, unitPriceMinor: 149000 }, { variantId: 'b', productId: 'p2', quantity: 1, unitPriceMinor: 299000 }], { deliveryMinor: 39000 });
    expect(t.subtotalMinor).toBe(597000);
    expect(t.totalMinor).toBe(636000);
  });
  it('процентная скидка с ограничением', () => {
    expect(calculateDiscount(100000, { type: 'PERCENT', value: 10 })).toBe(10000);
    expect(calculateDiscount(100000, { type: 'PERCENT', value: 10, maxDiscountMinor: 5000 })).toBe(5000);
    expect(calculateDiscount(100000, { type: 'FIXED', value: 150000 })).toBe(100000);
    expect(calculateDiscount(100000, { type: 'PERCENT', value: 10, minSubtotalMinor: 200000 })).toBe(0);
  });
  it('округление до копейки без float', () => {
    expect(percentOf(199999, 15)).toBe(30000);
    expect(percentOf(333, 33)).toBe(110);
  });
  it('комплект', () => {
    const b = calculateBundlePrice([{ unitPriceMinor: 199000, quantity: 1 }, { unitPriceMinor: 149000, quantity: 1 }], { discountPercent: 10 });
    expect(b).toEqual({ regularMinor: 348000, bundleMinor: 313200, savingsMinor: 34800 });
    expect(calculateBundlePrice([{ unitPriceMinor: 100000, quantity: 1 }], { discountPercent: 0, fixedPriceMinor: 90000 }).savingsMinor).toBe(10000);
  });
  it('форматирование', () => {
    expect(formatRub(199000)).toBe('1\u00A0990\u00A0₽');
    expect(formatRub(149050)).toBe('1\u00A0490,50\u00A0₽');
    expect(discountPercent(199000, 249000)).toBe(20);
  });
  it('отклоняет нецелые суммы', () => {
    expect(() => calculateTotals([{ variantId: 'a', productId: 'p', quantity: 1, unitPriceMinor: 10.5 }])).toThrow();
  });
});
