import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb, iphone14, iphone15pro, prisma, usbcCable } from './fixtures';
import { getProductBySlug, listProducts } from '../catalog/service';
import { getDeviceBySlug, searchDevices } from '../devices/service';
import { checkCompatibility, evaluateDeviceCatalog, setCompatibilityOverride, upsertExplicitRelation } from '../compatibility/service';
import { createDevice } from '@techmatch/testing';

describe('каталог и устройства (интеграция)', () => {
  let f: Awaited<ReturnType<typeof freshDb>>;
  beforeEach(async () => {
    f = await freshDb();
  });

  it('создание товара и выдача в каталоге с ценой и остатком', async () => {
    await usbcCable(f, 5);
    const list = await listProducts(prisma, { categorySlug: 'cables' });
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ slug: 'usb-c-cable-100w', priceMinor: 149000, inStock: true, stockQuantity: 5 });
    const page = await getProductBySlug(prisma, 'usb-c-cable-100w');
    expect(page.variants[0]?.sku).toBe('CAB-100');
  });

  it('создание устройства, поиск по алиасам и русскому написанию', async () => {
    await iphone15pro(f);
    await iphone14(f);
    const exact = await searchDevices(prisma, 'айфон 15 про');
    expect(exact.resolution).toBe('exact');
    expect(exact.best?.slug).toBe('apple-iphone-15-pro');
    const typo = await searchDevices(prisma, 'iphone15pro');
    expect(typo.best?.slug).toBe('apple-iphone-15-pro');
    const ambiguous = await searchDevices(prisma, 'iphone');
    expect(ambiguous.resolution).toBe('ambiguous');
    expect(ambiguous.candidates.length).toBe(2);
    const none = await searchDevices(prisma, 'Kyocera M2040', { log: true });
    expect(none.resolution).toBe('none');
    expect(await prisma.searchQueryLog.count({ where: { resultCount: 0 } })).toBe(1);
    const device = await getDeviceBySlug(prisma, 'apple-iphone-15-pro');
    expect(device.specifications.length).toBeGreaterThan(0);
  });

  it('связывание совместимости: правила → явная связь → override', async () => {
    const d15 = await iphone15pro(f);
    const d14 = await iphone14(f);
    const { product } = await usbcCable(f);
    const byRules = await checkCompatibility(prisma, { productId: product.id, deviceModelId: d15.id });
    expect(byRules.status).toBe('COMPATIBLE_WITH_LIMITATIONS');
    expect(byRules.source).toBe('RULE');
    expect((await checkCompatibility(prisma, { productId: product.id, deviceModelId: d14.id })).status).toBe('INCOMPATIBLE');

    await upsertExplicitRelation(prisma, { productId: product.id, deviceModelId: d15.id, status: 'VERIFIED', source: 'MANUFACTURER', reasons: ['Из спецификации'], evidence: [{ type: 'MANUFACTURER_DOC', url: 'https://example.com' }] });
    const verified = await checkCompatibility(prisma, { productId: product.id, deviceModelId: d15.id, log: true });
    expect(verified.source).toBe('MANUFACTURER');
    // ограничение по данным (USB 2.0) сохраняется даже при VERIFIED
    expect(verified.status).toBe('COMPATIBLE_WITH_LIMITATIONS');
    expect(verified.evidence?.length).toBe(1);
    expect(await prisma.compatibilityCheckLog.count()).toBe(1);

    await setCompatibilityOverride(prisma, { productId: product.id, deviceModelId: d15.id, status: 'INCOMPATIBLE', reason: 'Брак партии' });
    const overridden = await checkCompatibility(prisma, { productId: product.id, deviceModelId: d15.id });
    expect(overridden.status).toBe('INCOMPATIBLE');
    expect(overridden.source).toBe('ADMIN_OVERRIDE');

    const ev = await evaluateDeviceCatalog(prisma, d14.id, { persist: true, force: true });
    expect(ev.results.get(product.id)?.status).toBe('INCOMPATIBLE');
    expect(await prisma.compatibilityRelation.count({ where: { deviceModelId: d14.id, source: 'RULE' } })).toBe(1);
  });

  it('фильтр каталога по устройству оставляет только совместимые товары', async () => {
    const d14 = await iphone14(f);
    await usbcCable(f);
    await createDevice(prisma, f, { slug: 'x', name: 'x', specs: {} });
    const lightning = await prisma.product.create({ data: { slug: 'lightning-cable', name: 'Кабель Lightning', categoryId: f.categoryId, status: 'ACTIVE', variants: { create: { sku: 'CAB-L', name: 'Кабель Lightning', isDefault: true, prices: { create: { amountMinor: 99000 } }, inventory: { create: { warehouseId: f.warehouseId, quantity: 3 } } } } } });
    await prisma.productAttribute.createMany({ data: [{ productId: lightning.id, attributeId: f.attr.kind!, value: 'CABLE' }, { productId: lightning.id, attributeId: f.attr.connector_a!, value: 'USB_C' }, { productId: lightning.id, attributeId: f.attr.connector_b!, value: 'LIGHTNING' }] });
    const list = await listProducts(prisma, { deviceModelId: d14.id });
    expect(list.items.map((i) => i.slug)).toEqual(['lightning-cable']);
    expect(list.items[0]?.compatibility?.status).toBe('COMPATIBLE');
  });
});
