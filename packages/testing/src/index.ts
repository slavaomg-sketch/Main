/* Утилиты для интеграционных тестов: изолированная тестовая БД, сброс таблиц, минимальные фикстуры. */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@techmatch/database';

const here = dirname(fileURLToPath(import.meta.url));
export const DATABASE_PKG = join(here, '..', '..', 'database');

/** Переключает процесс на тестовую БД. Вызывать до импорта @techmatch/database. */
export function useTestDatabase(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL не задан — интеграционные тесты требуют отдельную БД');
  if (url === process.env.DATABASE_URL && !url.includes('_test')) throw new Error('TEST_DATABASE_URL совпадает с рабочей БД — отказ');
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.MEDIA_LOCAL_DIR = './storage/test-media';
  return url;
}

/** Применяет миграции к тестовой БД (globalSetup). */
export function migrateTestDatabase(): void {
  const url = useTestDatabase();
  execSync('pnpm exec prisma migrate deploy', { cwd: DATABASE_PKG, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}

/** Очищает все таблицы (кроме миграций). */
export async function resetDatabase(db: PrismaClient): Promise<void> {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  if (list) await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export interface Fixtures {
  warehouseId: string;
  categoryId: string;
  brandId: string;
  deviceCategoryId: string;
  deviceBrandId: string;
  attr: Record<string, string>;
}

/** Базовые справочники: склад, категория, бренд, атрибуты движка. */
export async function seedBase(db: PrismaClient): Promise<Fixtures> {
  const warehouse = await db.warehouse.create({ data: { code: 'main', name: 'Тест', isDefault: true } });
  const category = await db.accessoryCategory.create({ data: { slug: 'cables', name: 'Кабели' } });
  await db.accessoryCategory.createMany({ data: [{ slug: 'chargers', name: 'Зарядные устройства' }, { slug: 'other', name: 'Другое', sortOrder: 99 }] });
  const brand = await db.productBrand.create({ data: { slug: 'ugreen', name: 'UGREEN' } });
  const deviceCategory = await db.deviceCategory.create({ data: { slug: 'phones', name: 'Смартфоны', icon: 'smartphone' } });
  await db.deviceCategory.create({ data: { slug: 'laptops', name: 'Ноутбуки', icon: 'laptop' } });
  const deviceBrand = await db.deviceBrand.create({ data: { slug: 'apple', name: 'Apple' } });
  const codes = ['kind', 'connector_a', 'connector_b', 'outputs', 'power_watts', 'protocols', 'pd_voltages', 'cable_rated_watts', 'usb_version', 'data_gbps', 'charge_only', 'fits_models', 'wireless', 'requires_port', 'hdmi_out', 'dp_alt_mode', 'consumable_type', 'consumable_codes', 'band_groups', 'platforms'];
  const attr: Record<string, string> = {};
  for (const [i, code] of codes.entries()) {
    const a = await db.attributeDefinition.create({ data: { code, name: code, type: ['outputs', 'wireless'].includes(code) ? 'JSON' : ['protocols', 'pd_voltages', 'fits_models', 'consumable_codes', 'band_groups', 'platforms'].includes(code) ? 'LIST' : 'STRING', isCompatibilityRelevant: true, sortOrder: i } });
    attr[code] = a.id;
  }
  return { warehouseId: warehouse.id, categoryId: category.id, brandId: brand.id, deviceCategoryId: deviceCategory.id, deviceBrandId: deviceBrand.id, attr };
}

export async function createDevice(db: PrismaClient, f: Fixtures, input: { slug: string; name: string; fullName?: string; specs: Record<string, unknown>; aliases?: string[]; categoryId?: string; normalize?: (s: string) => string }) {
  const normalizeDeviceQuery = input.normalize ?? ((s: string) => s.toLowerCase().replace(/[^a-zа-я0-9]+/gi, ' ').trim());
  const model = await db.deviceModel.create({ data: { slug: input.slug, name: input.name, fullName: input.fullName ?? input.name, brandId: f.deviceBrandId, categoryId: input.categoryId ?? f.deviceCategoryId } });
  const aliases = new Map<string, string>();
  for (const a of [input.name, input.fullName ?? input.name, ...(input.aliases ?? [])]) aliases.set(normalizeDeviceQuery(a), a);
  await db.deviceAlias.createMany({ data: Array.from(aliases, ([normalized, alias]) => ({ deviceModelId: model.id, alias, normalized })) });
  await db.deviceSpecification.createMany({ data: Object.entries(input.specs).map(([key, value]) => ({ deviceModelId: model.id, key, value: value as object })) });
  return model;
}

export async function createProduct(db: PrismaClient, f: Fixtures, input: { slug: string; name: string; sku: string; priceMinor: number; stock: number; attrs: Record<string, unknown>; categoryId?: string }) {
  const product = await db.product.create({ data: { slug: input.slug, name: input.name, brandId: f.brandId, categoryId: input.categoryId ?? f.categoryId, status: 'ACTIVE', searchText: input.name.toLowerCase(), variants: { create: { sku: input.sku, name: input.name, isDefault: true } } }, include: { variants: true } });
  const variant = product.variants[0]!;
  await db.price.create({ data: { variantId: variant.id, amountMinor: input.priceMinor } });
  await db.inventory.create({ data: { variantId: variant.id, warehouseId: f.warehouseId, quantity: input.stock } });
  await db.productAttribute.createMany({ data: Object.entries(input.attrs).map(([code, value]) => ({ productId: product.id, attributeId: f.attr[code]!, value: value as object })) });
  return { product, variant };
}
