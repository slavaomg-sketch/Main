import { describe, expect, it } from 'vitest';
import { evaluateCompatibility } from '../engine';
import type { DeviceSpecProfile, ProductSpecProfile } from '../types';

const iphone15pro: DeviceSpecProfile = {
  slug: 'apple-iphone-15-pro',
  name: 'iPhone 15 Pro',
  categorySlug: 'phones',
  ecosystem: 'apple',
  ports: [{ type: 'USB_C', usbVersion: '3.2 Gen 2', dataGbps: 10, dpAltMode: true, pdIn: true }],
  charging: { protocols: ['USB_PD'], maxWatts: 27, viaUsb: true },
  wireless: { qi: true, qi2: true, magsafe: true, magsafeMaxWatts: 15, qiMaxWatts: 7.5 },
  physical: { caseFamily: 'iphone-15-pro' },
  audio: { bluetooth: '5.3', jack35: false },
};

const iphone14: DeviceSpecProfile = {
  slug: 'apple-iphone-14',
  name: 'iPhone 14',
  categorySlug: 'phones',
  ecosystem: 'apple',
  ports: [{ type: 'LIGHTNING', usbVersion: '2.0', pdIn: true }],
  charging: { protocols: ['USB_PD'], maxWatts: 20, viaUsb: true },
  wireless: { qi: true, magsafe: true, magsafeMaxWatts: 15, qiMaxWatts: 7.5 },
  physical: { caseFamily: 'iphone-14' },
};

const macbookAirM2: DeviceSpecProfile = {
  slug: 'apple-macbook-air-m2-13',
  name: 'MacBook Air 13" M2',
  categorySlug: 'laptops',
  ecosystem: 'apple',
  ports: [{ type: 'THUNDERBOLT', thunderbolt: 4, count: 2, usbVersion: 'USB4', dataGbps: 40, dpAltMode: true, pdIn: true }, { type: 'MAGSAFE_3' }, { type: 'JACK_3_5' }],
  charging: { protocols: ['USB_PD'], maxWatts: 67, minWatts: 30, pdVoltages: [20], viaUsb: true },
  physical: { screenInches: 13.6 },
};

const galaxyS25: DeviceSpecProfile = {
  slug: 'samsung-galaxy-s25',
  name: 'Galaxy S25',
  categorySlug: 'phones',
  ecosystem: 'android',
  ports: [{ type: 'USB_C', usbVersion: '3.2 Gen 1', dataGbps: 5, dpAltMode: true, pdIn: true }],
  charging: { protocols: ['USB_PD', 'PPS'], maxWatts: 45, viaUsb: true },
  wireless: { qi: true, qiMaxWatts: 15 },
};

const canonG3410: DeviceSpecProfile = {
  slug: 'canon-pixma-g3410',
  name: 'Canon PIXMA G3410',
  categorySlug: 'printers',
  ecosystem: 'printer',
  ports: [{ type: 'USB_B', usbVersion: '2.0' }],
  consumables: { inkBottles: ['GI-41BK', 'GI-41C', 'GI-41M', 'GI-41Y'] },
};

const ps5: DeviceSpecProfile = {
  slug: 'sony-playstation-5',
  name: 'PlayStation 5',
  categorySlug: 'gaming',
  ecosystem: 'playstation',
  ports: [{ type: 'USB_A', usbVersion: '3.2 Gen 2' }, { type: 'USB_C', usbVersion: '3.2 Gen 2' }, { type: 'HDMI', hdmiVersion: '2.1' }],
  audio: { bluetooth: '5.1' },
};

const base = (p: Partial<ProductSpecProfile>): ProductSpecProfile => ({ id: 'p', slug: 'p', name: 'Товар', kind: 'OTHER', ...p });

describe('Compatibility Engine', () => {
  it('USB-C кабель 100 Вт полностью совместим с iPhone 15 Pro', () => {
    const r = evaluateCompatibility(iphone15pro, base({ kind: 'CABLE', connectorA: 'USB_C', connectorB: 'USB_C', cableRatedWatts: 100, usbVersion: '2.0' }));
    expect(r.status).toBe('COMPATIBLE_WITH_LIMITATIONS');
    expect(r.limitations.join(' ')).toMatch(/USB 2\.0|480/);
  });

  it('USB-C кабель USB 3.2 Gen 2 полностью совместим с iPhone 15 Pro', () => {
    const r = evaluateCompatibility(iphone15pro, base({ kind: 'CABLE', connectorA: 'USB_C', connectorB: 'USB_C', cableRatedWatts: 100, usbVersion: '3.2 Gen 2', dataGbps: 10 }));
    expect(r.status).toBe('COMPATIBLE');
    expect(r.rulesApplied).toContain('CONNECTOR_MATCH');
  });

  it('USB-C кабель не совместим с iPhone 14 (Lightning)', () => {
    const r = evaluateCompatibility(iphone14, base({ kind: 'CABLE', connectorA: 'USB_C', connectorB: 'USB_C' }));
    expect(r.status).toBe('INCOMPATIBLE');
    expect(r.reasons[0]).toMatch(/Lightning/);
  });

  it('кабель USB-C — Lightning совместим с iPhone 14', () => {
    const r = evaluateCompatibility(iphone14, base({ kind: 'CABLE', connectorA: 'USB_C', connectorB: 'LIGHTNING', cableRatedWatts: 20 }));
    expect(r.status).toBe('COMPATIBLE');
  });

  it('зарядка 30 Вт PD — MacBook Air M2 с ограничением (ниже максимума 67 Вт, но ≥ 30)', () => {
    const r = evaluateCompatibility(macbookAirM2, base({ kind: 'CHARGER', outputs: [{ type: 'USB_C', maxWatts: 30, protocols: ['USB_PD'] }], powerWatts: 30, protocols: ['USB_PD'], pdVoltages: [5, 9, 15, 20] }));
    expect(r.status).toBe('COMPATIBLE_WITH_LIMITATIONS');
    expect(r.limitations[0]).toMatch(/медленнее/);
  });

  it('зарядка 20 Вт — MacBook Air: сильно ограничено', () => {
    const r = evaluateCompatibility(macbookAirM2, base({ kind: 'CHARGER', outputs: [{ type: 'USB_C', maxWatts: 20, protocols: ['USB_PD'] }], powerWatts: 20, protocols: ['USB_PD'] }));
    expect(r.status).toBe('COMPATIBLE_WITH_LIMITATIONS');
    expect(r.constraints.some((c) => c.kind === 'REDUCED_POWER')).toBe(true);
  });

  it('зарядка 12 Вт USB-A не подходит MacBook', () => {
    const r = evaluateCompatibility(macbookAirM2, base({ kind: 'CHARGER', outputs: [{ type: 'USB_A', maxWatts: 12 }], powerWatts: 12 }));
    expect(r.status).toBe('INCOMPATIBLE');
  });

  it('зарядка 65 Вт PD без PPS — Galaxy S25 с ограничением', () => {
    const r = evaluateCompatibility(galaxyS25, base({ kind: 'CHARGER', outputs: [{ type: 'USB_C', maxWatts: 65, protocols: ['USB_PD'] }], powerWatts: 65, protocols: ['USB_PD'] }));
    expect(r.status).toBe('COMPATIBLE_WITH_LIMITATIONS');
    expect(r.limitations[0]).toMatch(/PPS/);
  });

  it('зарядка 45 Вт PPS — Galaxy S25 полностью совместима', () => {
    const r = evaluateCompatibility(galaxyS25, base({ kind: 'CHARGER', outputs: [{ type: 'USB_C', maxWatts: 45, protocols: ['USB_PD', 'PPS'] }], powerWatts: 45, protocols: ['USB_PD', 'PPS'] }));
    expect(r.status).toBe('COMPATIBLE');
    expect(r.reasons.join(' ')).toMatch(/PPS/);
  });

  it('MagSafe-зарядка на Galaxy S25 — только Qi без магнитов', () => {
    const r = evaluateCompatibility(galaxyS25, base({ kind: 'WIRELESS_CHARGER', wireless: { magsafe: true, watts: 15 } }));
    expect(r.status).toBe('COMPATIBLE_WITH_LIMITATIONS');
    expect(r.limitations[0]).toMatch(/Магнитное/);
  });

  it('MagSafe-зарядка на iPhone 15 Pro — совместимо', () => {
    const r = evaluateCompatibility(iphone15pro, base({ kind: 'WIRELESS_CHARGER', wireless: { magsafe: true, watts: 15 } }));
    expect(r.status).toBe('COMPATIBLE');
  });

  it('беспроводная зарядка на принтере — несовместимо', () => {
    const r = evaluateCompatibility(canonG3410, base({ kind: 'WIRELESS_CHARGER', wireless: { qi: true } }));
    expect(r.status).toBe('INCOMPATIBLE');
  });

  it('чернила GI-41 подходят Canon G3410', () => {
    const r = evaluateCompatibility(canonG3410, base({ kind: 'CONSUMABLE', consumableType: 'inkBottles', consumableCodes: ['GI-41BK'] }));
    expect(r.status).toBe('COMPATIBLE');
    expect(r.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('тонер HP не подходит Canon G3410', () => {
    const r = evaluateCompatibility(canonG3410, base({ kind: 'CONSUMABLE', consumableType: 'toners', consumableCodes: ['W1500A'] }));
    expect(r.status).toBe('INCOMPATIBLE');
  });

  it('картридж для iPhone — несовместимо по области применения', () => {
    const r = evaluateCompatibility(iphone15pro, base({ kind: 'CONSUMABLE', consumableCodes: ['GI-41BK'] }));
    expect(r.status).toBe('INCOMPATIBLE');
    expect(r.rulesApplied).toEqual(['CATEGORY_SCOPE']);
  });

  it('кабель USB-B подходит принтеру', () => {
    const r = evaluateCompatibility(canonG3410, base({ kind: 'CABLE', connectorA: 'USB_A', connectorB: 'USB_B', usbVersion: '2.0' }));
    expect(r.status).toBe('COMPATIBLE');
  });

  it('чехол для iPhone 15 Pro не подходит iPhone 14', () => {
    const product = base({ kind: 'CASE', fitsModels: ['apple-iphone-15-pro'] });
    expect(evaluateCompatibility(iphone15pro, product).status).toBe('COMPATIBLE');
    expect(evaluateCompatibility(iphone14, product).status).toBe('INCOMPATIBLE');
  });

  it('DualSense подходит PS5, но не iPhone без указания платформы', () => {
    const product = base({ kind: 'CONTROLLER', platforms: ['playstation', 'windows'] });
    expect(evaluateCompatibility(ps5, product).status).toBe('COMPATIBLE');
    expect(evaluateCompatibility(iphone14, product).status).toBe('INCOMPATIBLE');
  });

  it('хаб с HDMI на MacBook Air — совместим с thunderbolt', () => {
    const r = evaluateCompatibility(macbookAirM2, base({ kind: 'HUB', requiresPort: 'USB_C', hdmiOut: true, powerWatts: 100, usbVersion: '3.2 Gen 1' }));
    expect(r.status).toBe('COMPATIBLE');
  });

  it('хаб на устройстве без DP Alt Mode — с ограничением видеовыхода', () => {
    const dev: DeviceSpecProfile = { ...galaxyS25, ports: [{ type: 'USB_C', usbVersion: '2.0', dpAltMode: false, pdIn: true }] };
    const r = evaluateCompatibility(dev, base({ kind: 'HUB', requiresPort: 'USB_C', hdmiOut: true }));
    expect(r.status).toBe('COMPATIBLE_WITH_LIMITATIONS');
    expect(r.constraints.some((c) => c.kind === 'NO_VIDEO_OUTPUT')).toBe(true);
  });

  it('override администратора имеет высший приоритет', () => {
    const r = evaluateCompatibility(iphone14, base({ kind: 'CABLE', connectorA: 'USB_C', connectorB: 'USB_C' }), {
      override: { status: 'COMPATIBLE_WITH_LIMITATIONS', reason: 'Проверено с переходником' },
    });
    expect(r.status).toBe('COMPATIBLE_WITH_LIMITATIONS');
    expect(r.source).toBe('ADMIN_OVERRIDE');
  });

  it('явная VERIFIED-связь повышает статус, но не скрывает ограничения правил', () => {
    const r = evaluateCompatibility(macbookAirM2, base({ kind: 'CHARGER', outputs: [{ type: 'USB_C', maxWatts: 30, protocols: ['USB_PD'] }], powerWatts: 30, protocols: ['USB_PD'] }), {
      explicit: { status: 'VERIFIED', source: 'MANUFACTURER', verifiedAt: new Date() },
    });
    expect(r.status).toBe('COMPATIBLE_WITH_LIMITATIONS');
    expect(r.source).toBe('MANUFACTURER');
  });

  it('товар без релевантных атрибутов — UNKNOWN', () => {
    const r = evaluateCompatibility(iphone15pro, base({ kind: 'OTHER' }));
    expect(r.status).toBe('UNKNOWN');
  });

  it('ремешок 45 мм не подходит часам 41 мм', () => {
    const watch41: DeviceSpecProfile = { slug: 'apple-watch-s9-41', name: 'Apple Watch Series 9 41 мм', categorySlug: 'watches', ports: [], physical: { bandGroup: 'apple-41' } };
    expect(evaluateCompatibility(watch41, base({ kind: 'WATCH_BAND', bandGroups: ['apple-45'] })).status).toBe('INCOMPATIBLE');
    expect(evaluateCompatibility(watch41, base({ kind: 'WATCH_BAND', bandGroups: ['apple-41'] })).status).toBe('COMPATIBLE');
  });
});
