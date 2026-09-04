import { prisma } from '@techmatch/database';
import { createDevice, createProduct, resetDatabase, seedBase, type Fixtures } from '@techmatch/testing';
import { invalidateCompatibilityCache } from '../compatibility/service';
import { normalizeDeviceQuery } from '../shared/normalize';

export { prisma };

export async function freshDb(): Promise<Fixtures> {
  await resetDatabase(prisma);
  invalidateCompatibilityCache();
  return seedBase(prisma);
}

export async function iphone15pro(f: Fixtures) {
  return createDevice(prisma, f, {
    slug: 'apple-iphone-15-pro',
    name: 'iPhone 15 Pro',
    fullName: 'Apple iPhone 15 Pro (2023)',
    aliases: ['айфон 15 про', 'iphone15pro'],
    normalize: normalizeDeviceQuery,
    specs: { ecosystem: 'apple', ports: [{ type: 'USB_C', usbVersion: '3.2 Gen 2', dataGbps: 10, dpAltMode: true, pdIn: true }], charging: { protocols: ['USB_PD'], maxWatts: 27, viaUsb: true }, wireless: { qi: true, qi2: true, magsafe: true, magsafeMaxWatts: 15, qiMaxWatts: 7.5 }, physical: { caseFamily: 'iphone-15-pro' } },
  });
}

export async function iphone14(f: Fixtures) {
  return createDevice(prisma, f, {
    slug: 'apple-iphone-14',
    name: 'iPhone 14',
    fullName: 'Apple iPhone 14 (2022)',
    aliases: ['айфон 14'],
    normalize: normalizeDeviceQuery,
    specs: { ecosystem: 'apple', ports: [{ type: 'LIGHTNING', usbVersion: '2.0', pdIn: true }], charging: { protocols: ['USB_PD'], maxWatts: 20, viaUsb: true }, wireless: { qi: true, magsafe: true }, physical: { caseFamily: 'iphone-14' } },
  });
}

export async function usbcCable(f: Fixtures, stock = 10) {
  return createProduct(prisma, f, { slug: 'usb-c-cable-100w', name: 'Кабель USB-C — USB-C 100 Вт', sku: 'CAB-100', priceMinor: 149000, stock, attrs: { kind: 'CABLE', connector_a: 'USB_C', connector_b: 'USB_C', cable_rated_watts: 100, usb_version: '2.0' } });
}

export async function charger30(f: Fixtures, stock = 10) {
  return createProduct(prisma, f, { slug: 'charger-30w', name: 'Зарядка 30 Вт', sku: 'CHG-30', priceMinor: 199000, stock, attrs: { kind: 'CHARGER', outputs: [{ type: 'USB_C', maxWatts: 30, protocols: ['USB_PD', 'PPS'] }], power_watts: 30, protocols: ['USB_PD', 'PPS'] } });
}
