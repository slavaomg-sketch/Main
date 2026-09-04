/* eslint-disable no-console */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnv } from '@techmatch/config';
import { prisma, type Prisma } from '../index';
import {
  buildProductSearchText,
  DEFAULT_HOMEPAGE,
  ensureRolesAndPermissions,
  hashPassword,
  normalizeDeviceQuery,
  normalizeIdentifier,
  slugify,
  storeImageFromFile,
  upsertExplicitRelation,
  setCompatibilityOverride,
  evaluateDeviceCatalog,
  generateOrderPublicId,
} from '@techmatch/domain';
import { DEVICES, DEVICE_BRANDS, DEVICE_CATEGORIES } from './data/devices';
import { ACCESSORY_CATEGORIES, EXPLICIT_RELATIONS, OVERRIDES, PRODUCTS, PRODUCT_BRANDS } from './data/products';
import { BANNERS, BUNDLES, COLLECTIONS, FAQ, PAGES, PROMOTIONS } from './data/content';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, '..', '..', 'seed-assets', 'images');
const credits: Record<string, { file: string; title: string; source: string; license: string; author: string }> = existsSync(join(ASSETS, 'credits.json')) ? JSON.parse(readFileSync(join(ASSETS, 'credits.json'), 'utf8')) : {};

const imageCache = new Map<string, string>();
async function image(key: string | undefined): Promise<string | null> {
  if (!key) return null;
  if (imageCache.has(key)) return imageCache.get(key)!;
  const file = join(ASSETS, `${key}.jpg`);
  if (!existsSync(file)) {
    console.warn(`  ! нет изображения ${key}`);
    return null;
  }
  const c = credits[key];
  const asset = await storeImageFromFile(prisma, file, { source: 'SEED', license: c?.license ?? null, attribution: c ? `${c.author} — ${c.title} (${c.source})` : null, originalUrl: c?.source ?? null });
  imageCache.set(key, asset.id);
  return asset.id;
}

const ATTRIBUTES: Array<{ code: string; name: string; type: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'ENUM' | 'LIST' | 'JSON'; group: string; unit?: string; compat?: boolean; filterable?: boolean; visible?: boolean }> = [
  { code: 'kind', name: 'Тип аксессуара', type: 'ENUM', group: 'Совместимость', compat: true, filterable: true, visible: false },
  { code: 'connector_a', name: 'Разъём A', type: 'ENUM', group: 'Разъёмы', compat: true, filterable: true },
  { code: 'connector_b', name: 'Разъём B', type: 'ENUM', group: 'Разъёмы', compat: true, filterable: true },
  { code: 'requires_port', name: 'Требуемый порт устройства', type: 'ENUM', group: 'Разъёмы', compat: true },
  { code: 'outputs', name: 'Выходы', type: 'JSON', group: 'Питание', compat: true, visible: false },
  { code: 'power_watts', name: 'Мощность', type: 'NUMBER', unit: 'Вт', group: 'Питание', compat: true, filterable: true },
  { code: 'protocols', name: 'Протоколы зарядки', type: 'LIST', group: 'Питание', compat: true, filterable: true },
  { code: 'pd_voltages', name: 'Профили напряжения PD', type: 'LIST', unit: 'В', group: 'Питание', compat: true },
  { code: 'cable_rated_watts', name: 'Номинальная мощность кабеля', type: 'NUMBER', unit: 'Вт', group: 'Питание', compat: true },
  { code: 'usb_version', name: 'Версия USB', type: 'STRING', group: 'Данные', compat: true },
  { code: 'data_gbps', name: 'Скорость передачи', type: 'NUMBER', unit: 'Гбит/с', group: 'Данные', compat: true },
  { code: 'charge_only', name: 'Только зарядка', type: 'BOOLEAN', group: 'Данные', compat: true },
  { code: 'dp_alt_mode', name: 'DisplayPort Alt Mode', type: 'BOOLEAN', group: 'Видео', compat: true },
  { code: 'thunderbolt', name: 'Thunderbolt', type: 'NUMBER', group: 'Видео', compat: true },
  { code: 'thunderbolt_required', name: 'Требует Thunderbolt', type: 'BOOLEAN', group: 'Видео', compat: true },
  { code: 'hdmi_version', name: 'Версия HDMI', type: 'STRING', group: 'Видео', compat: true },
  { code: 'hdmi_out', name: 'Видеовыход HDMI', type: 'BOOLEAN', group: 'Видео', compat: true },
  { code: 'wireless', name: 'Беспроводная зарядка', type: 'JSON', group: 'Беспроводная зарядка', compat: true, visible: false },
  { code: 'wireless_charging', name: 'Беспроводная зарядка в держателе', type: 'BOOLEAN', group: 'Беспроводная зарядка', compat: true },
  { code: 'fits_models', name: 'Подходит для моделей', type: 'LIST', group: 'Совместимость', compat: true, visible: false },
  { code: 'fits_case_families', name: 'Подходит для форм-факторов', type: 'LIST', group: 'Совместимость', compat: true, visible: false },
  { code: 'consumable_type', name: 'Тип расходника', type: 'ENUM', group: 'Расходники', compat: true },
  { code: 'consumable_codes', name: 'Коды расходника', type: 'LIST', group: 'Расходники', compat: true },
  { code: 'region', name: 'Регион', type: 'STRING', group: 'Расходники', compat: true },
  { code: 'band_groups', name: 'Размер ремешка', type: 'LIST', group: 'Совместимость', compat: true },
  { code: 'platforms', name: 'Платформы', type: 'LIST', group: 'Совместимость', compat: true, filterable: true },
  { code: 'vesa', name: 'VESA', type: 'LIST', group: 'Физические', compat: true },
  { code: 'screen_min_inches', name: 'Мин. диагональ', type: 'NUMBER', unit: '″', group: 'Физические', compat: true },
  { code: 'screen_max_inches', name: 'Макс. диагональ', type: 'NUMBER', unit: '″', group: 'Физические', compat: true },
  { code: 'card_type', name: 'Тип карты памяти', type: 'ENUM', group: 'Данные', compat: true },
  { code: 'capacity_gb', name: 'Объём', type: 'NUMBER', unit: 'ГБ', group: 'Данные', compat: true, filterable: true },
  { code: 'bluetooth', name: 'Bluetooth', type: 'BOOLEAN', group: 'Подключение', compat: true },
  { code: 'jack_35', name: 'Разъём 3,5 мм', type: 'BOOLEAN', group: 'Подключение', compat: true },
];

async function seedCore() {
  console.log('→ Роли, права, склад, атрибуты');
  await ensureRolesAndPermissions(prisma);
  await prisma.warehouse.upsert({ where: { code: 'main' }, create: { code: 'main', name: 'Основной склад (Москва)', address: 'Москва, демо-склад', isDefault: true }, update: {} });
  for (const [i, a] of ATTRIBUTES.entries()) {
    await prisma.attributeDefinition.upsert({ where: { code: a.code }, create: { code: a.code, name: a.name, type: a.type, unit: a.unit, group: a.group, isCompatibilityRelevant: a.compat ?? false, isFilterable: a.filterable ?? false, isVisible: a.visible ?? true, sortOrder: i }, update: { name: a.name, type: a.type, unit: a.unit, group: a.group, isCompatibilityRelevant: a.compat ?? false, isFilterable: a.filterable ?? false, isVisible: a.visible ?? true, sortOrder: i } });
  }
  const env = getEnv();
  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'owner' } });
  await prisma.adminUser.upsert({ where: { email: env.SEED_ADMIN_EMAIL }, create: { email: env.SEED_ADMIN_EMAIL, name: 'Владелец магазина', passwordHash: hashPassword(env.SEED_ADMIN_PASSWORD), roleId: ownerRole.id }, update: { roleId: ownerRole.id } });
  const catalogRole = await prisma.role.findUniqueOrThrow({ where: { code: 'catalog_manager' } });
  await prisma.adminUser.upsert({ where: { email: 'catalog@techmatch.local' }, create: { email: 'catalog@techmatch.local', name: 'Менеджер каталога', passwordHash: hashPassword('Catalog12345!'), roleId: catalogRole.id }, update: {} });
  const orderRole = await prisma.role.findUniqueOrThrow({ where: { code: 'order_manager' } });
  await prisma.adminUser.upsert({ where: { email: 'orders@techmatch.local' }, create: { email: 'orders@techmatch.local', name: 'Менеджер заказов', passwordHash: hashPassword('Orders12345!'), roleId: orderRole.id }, update: {} });
}

async function seedDevices() {
  console.log('→ Устройства');
  for (const c of DEVICE_CATEGORIES) await prisma.deviceCategory.upsert({ where: { slug: c.slug }, create: c, update: c });
  for (const [i, b] of DEVICE_BRANDS.entries()) await prisma.deviceBrand.upsert({ where: { slug: slugify(b) }, create: { slug: slugify(b), name: b, sortOrder: i }, update: { name: b, sortOrder: i } });
  for (const d of DEVICES) {
    const brand = await prisma.deviceBrand.findUniqueOrThrow({ where: { slug: slugify(d.brand) } });
    const category = await prisma.deviceCategory.findUniqueOrThrow({ where: { slug: d.category } });
    const family = d.family
      ? await prisma.deviceFamily.upsert({ where: { slug: slugify(`${d.brand} ${d.family}`) }, create: { slug: slugify(`${d.brand} ${d.family}`), name: d.family, brandId: brand.id, categoryId: category.id }, update: { name: d.family } })
      : null;
    const imageAssetId = await image(d.image);
    const asset = imageAssetId ? await prisma.mediaAsset.findUnique({ where: { id: imageAssetId } }) : null;
    const data = {
      name: d.name, fullName: d.fullName, brandId: brand.id, categoryId: category.id, familyId: family?.id ?? null, generation: d.generation ?? null, releaseYear: d.year ?? null, primaryModelNumber: d.modelNumber ?? null,
      description: d.description ?? null, imageAssetId, imageUrl: asset ? ((asset.variants as Record<string, string>).card ?? asset.publicUrl) : null, popularity: d.popularity ?? 0, specsAreDemo: d.demo ?? false, isActive: true,
    };
    const model = await prisma.deviceModel.upsert({ where: { slug: d.slug }, create: { slug: d.slug, ...data }, update: data });
    // алиасы
    await prisma.deviceAlias.deleteMany({ where: { deviceModelId: model.id } });
    const aliasSet = new Map<string, { alias: string; kind: 'SYNONYM' | 'TYPO' | 'TRANSLIT' | 'SHORT' | 'MARKETING'; weight: number }>();
    const add = (alias: string, kind: 'SYNONYM' | 'TYPO' | 'TRANSLIT' | 'SHORT' | 'MARKETING', weight: number) => {
      const n = normalizeDeviceQuery(alias);
      if (n.length >= 2 && !aliasSet.has(n)) aliasSet.set(n, { alias, kind, weight });
    };
    add(d.name, 'MARKETING', 3);
    add(d.fullName, 'MARKETING', 3);
    add(`${d.brand} ${d.name}`, 'SYNONYM', 3);
    for (const a of d.aliases) add(a, /[а-я]/i.test(a) ? 'TRANSLIT' : 'SYNONYM', 2);
    if (d.modelNumber) add(d.modelNumber, 'SHORT', 2);
    await prisma.deviceAlias.createMany({ data: Array.from(aliasSet, ([normalized, v]) => ({ deviceModelId: model.id, alias: v.alias, normalized, kind: v.kind, weight: v.weight })) });
    // идентификаторы
    await prisma.deviceIdentifier.deleteMany({ where: { deviceModelId: model.id } });
    if (d.identifiers?.length) {
      await prisma.deviceIdentifier.createMany({ data: d.identifiers.map((i) => ({ deviceModelId: model.id, type: i.type, value: i.value, normalized: normalizeIdentifier(i.value), region: i.region ?? null })), skipDuplicates: true });
    }
    // характеристики модели
    await prisma.deviceSpecification.deleteMany({ where: { deviceModelId: model.id } });
    await prisma.deviceSpecification.createMany({ data: Object.entries(d.specs).filter(([, v]) => v !== undefined).map(([key, value]) => ({ deviceModelId: model.id, key, value: value as Prisma.InputJsonValue, source: d.demo ? 'DEMO' : 'MANUFACTURER', isDemo: d.demo ?? false, verifiedAt: d.demo ? null : new Date() })) });
    // варианты
    for (const [i, v] of (d.variants ?? []).entries()) {
      const variant = await prisma.deviceVariant.upsert({ where: { deviceModelId_slug: { deviceModelId: model.id, slug: v.slug } }, create: { deviceModelId: model.id, slug: v.slug, name: v.name, sortOrder: i }, update: { name: v.name, sortOrder: i } });
      if (v.specs) await prisma.deviceSpecification.createMany({ data: Object.entries(v.specs).map(([key, value]) => ({ deviceModelId: model.id, variantId: variant.id, key, value: value as Prisma.InputJsonValue, source: 'MANUFACTURER', verifiedAt: new Date() })) });
      for (const a of v.aliases ?? []) {
        const n = normalizeDeviceQuery(a);
        if (!aliasSet.has(n)) {
          aliasSet.set(n, { alias: a, kind: 'SYNONYM', weight: 2 });
          await prisma.deviceAlias.create({ data: { deviceModelId: model.id, variantId: variant.id, alias: a, normalized: n, kind: 'SYNONYM', weight: 2 } });
        }
      }
    }
  }
}

async function seedCatalog() {
  console.log('→ Каталог');
  for (const c of ACCESSORY_CATEGORIES) await prisma.accessoryCategory.upsert({ where: { slug: c.slug }, create: c, update: c });
  for (const [i, b] of PRODUCT_BRANDS.entries()) await prisma.productBrand.upsert({ where: { slug: slugify(b.name) }, create: { slug: slugify(b.name), name: b.name, isPopular: b.popular ?? false, sortOrder: b.sortOrder ?? 100 + i }, update: { name: b.name, isPopular: b.popular ?? false, sortOrder: b.sortOrder ?? 100 + i } });
  const warehouse = await prisma.warehouse.findUniqueOrThrow({ where: { code: 'main' } });
  const attrs = new Map((await prisma.attributeDefinition.findMany()).map((a) => [a.code, a.id]));
  for (const p of PRODUCTS) {
    const brand = await prisma.productBrand.findUniqueOrThrow({ where: { slug: slugify(p.brand) } });
    const category = await prisma.accessoryCategory.findUniqueOrThrow({ where: { slug: p.category } });
    const variants = p.variants?.length ? p.variants : [{ sku: p.sku ?? `TM-${p.slug.toUpperCase()}`, name: p.name, options: {}, price: p.price, compareAt: p.compareAt, stock: p.stock }];
    const data = {
      name: p.name, brandId: brand.id, categoryId: category.id, status: 'ACTIVE' as const, shortDescription: p.short ?? null, description: p.description ?? null, baseSku: p.sku ?? variants[0]!.sku,
      rating: p.rating ?? 0, reviewCount: p.reviews ?? 0, badges: [...(p.badges ?? [])], packageContents: [...(p.packageContents ?? [])], warrantyMonths: p.warrantyMonths ?? 12, isFeatured: p.featured ?? false, isNew: p.isNew ?? false, popularity: p.popularity ?? 0,
      searchText: buildProductSearchText({ name: p.name, brandName: brand.name, categoryName: category.name, skus: variants.map((v) => v.sku), shortDescription: p.short }),
      seoTitle: `${p.name} — купить в TechMatch`, seoDescription: p.short ?? null,
    };
    const product = await prisma.product.upsert({ where: { slug: p.slug }, create: { slug: p.slug, ...data }, update: data });
    // атрибуты
    await prisma.productAttribute.deleteMany({ where: { productId: product.id } });
    const attrRows: Prisma.ProductAttributeCreateManyInput[] = [];
    for (const [code, value] of Object.entries(p.attrs)) {
      const attributeId = attrs.get(code);
      if (!attributeId) throw new Error(`Неизвестный атрибут ${code} у ${p.slug}`);
      attrRows.push({ productId: product.id, attributeId, value: value as Prisma.InputJsonValue, scopeKey: '' });
    }
    // видимые характеристики — как JSON-атрибут specs? Храним в отдельных AttributeDefinition "spec:*"
    for (const [name, value] of Object.entries(p.specs ?? {})) {
      const code = `spec_${slugify(name).replace(/-/g, '_')}`;
      let attributeId = attrs.get(code);
      if (!attributeId) {
        const created = await prisma.attributeDefinition.upsert({ where: { code }, create: { code, name, type: 'STRING', group: 'Характеристики', isVisible: true, sortOrder: 500 }, update: {} });
        attributeId = created.id;
        attrs.set(code, attributeId);
      }
      attrRows.push({ productId: product.id, attributeId, value, scopeKey: '' });
    }
    // варианты
    const keepVariantIds: string[] = [];
    for (const [i, v] of variants.entries()) {
      const vData = { productId: product.id, name: v.name, optionValues: v.options as Prisma.InputJsonValue, isDefault: i === 0, weightGrams: p.weightGrams ?? null, sortOrder: i, status: 'ACTIVE' as const };
      const variant = await prisma.productVariant.upsert({ where: { sku: v.sku }, create: { sku: v.sku, ...vData }, update: vData });
      keepVariantIds.push(variant.id);
      const price = Math.round((v.price ?? p.price) * 100);
      const compareAt = (v.compareAt ?? (v.price === undefined ? p.compareAt : undefined)) ? Math.round((v.compareAt ?? p.compareAt!) * 100) : null;
      const current = await prisma.price.findFirst({ where: { variantId: variant.id, priceList: 'retail', validTo: null }, orderBy: { validFrom: 'desc' } });
      if (!current || current.amountMinor !== price || current.compareAtMinor !== compareAt) {
        if (current) await prisma.price.update({ where: { id: current.id }, data: { validTo: new Date() } });
        await prisma.price.create({ data: { variantId: variant.id, amountMinor: price, compareAtMinor: compareAt, validFrom: new Date(Date.now() - 1000) } });
      }
      await prisma.inventory.upsert({ where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } }, create: { variantId: variant.id, warehouseId: warehouse.id, quantity: v.stock ?? p.stock ?? 10 }, update: { quantity: v.stock ?? p.stock ?? 10 } });
      if (v.attrs) {
        for (const [code, value] of Object.entries(v.attrs)) attrRows.push({ productId: product.id, variantId: variant.id, attributeId: attrs.get(code)!, value: value as Prisma.InputJsonValue, scopeKey: variant.id });
      }
      if (v.image && v.image !== p.image) {
        const assetId = await image(v.image);
        if (assetId) {
          const exists = await prisma.productImage.findFirst({ where: { productId: product.id, variantId: variant.id, assetId } });
          if (!exists) await prisma.productImage.create({ data: { productId: product.id, variantId: variant.id, assetId, alt: `${p.name} — ${v.name}`, sortOrder: 10 + i } });
        }
      }
    }
    await prisma.productVariant.updateMany({ where: { productId: product.id, id: { notIn: keepVariantIds } }, data: { status: 'ARCHIVED' } });
    await prisma.productAttribute.createMany({ data: attrRows });
    // изображения
    const images = [p.image, ...(p.images ?? [])].filter(Boolean) as string[];
    for (const [i, key] of images.entries()) {
      const assetId = await image(key);
      if (!assetId) continue;
      const exists = await prisma.productImage.findFirst({ where: { productId: product.id, assetId, variantId: null } });
      if (!exists) await prisma.productImage.create({ data: { productId: product.id, assetId, alt: p.name, sortOrder: i, isPrimary: i === 0 } });
    }
    // отзывы (демо)
    if ((p.reviews ?? 0) > 0 && (await prisma.review.count({ where: { productId: product.id } })) === 0) {
      const samples = [
        { authorName: 'Алексей', rating: 5, body: 'Всё подошло, работает как заявлено. Заказ пришёл быстро.' },
        { authorName: 'Марина', rating: Math.max(3, Math.round(p.rating ?? 4)), body: 'Качество хорошее, соответствует описанию. Сервис подбора реально помог не ошибиться с моделью.' },
        { authorName: 'Дмитрий', rating: 4, body: 'Нормальный аксессуар за свои деньги. Упаковка целая, гарантийный талон в комплекте.' },
      ];
      await prisma.review.createMany({ data: samples.map((s) => ({ ...s, productId: product.id, isApproved: true })) });
    }
  }
}

async function seedCompatibility() {
  console.log('→ Явные связи совместимости и override');
  for (const r of EXPLICIT_RELATIONS) {
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: r.product } });
    const device = await prisma.deviceModel.findUniqueOrThrow({ where: { slug: r.device } });
    const existing = await prisma.compatibilityRelation.findUnique({ where: { productId_deviceModelId_scopeKey: { productId: product.id, deviceModelId: device.id, scopeKey: '*:*' } }, include: { evidence: true } });
    await upsertExplicitRelation(prisma, { productId: product.id, deviceModelId: device.id, status: r.status, source: r.source, reasons: r.reasons ? [...r.reasons] : [], limitations: r.limitations ? [...r.limitations] : [], evidence: r.evidence && !existing?.evidence.length ? [{ type: r.evidence.type, url: r.evidence.url, note: r.evidence.note }] : [] });
  }
  for (const o of OVERRIDES) {
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: o.product } });
    const device = await prisma.deviceModel.findUniqueOrThrow({ where: { slug: o.device } });
    await setCompatibilityOverride(prisma, { productId: product.id, deviceModelId: device.id, status: o.status, reason: o.reason });
  }
  console.log('→ Предрасчёт правиловых связей');
  const devices = await prisma.deviceModel.findMany({ select: { id: true } });
  for (const d of devices) await evaluateDeviceCatalog(prisma, d.id, { persist: true, force: true });
}

async function seedContent() {
  console.log('→ Контент и маркетинг');
  await prisma.siteSetting.upsert({ where: { key: 'homepage' }, create: { key: 'homepage', value: DEFAULT_HOMEPAGE as unknown as Prisma.InputJsonValue }, update: {} });
  const heroImages: Array<{ key: string; url: string; alt: string }> = [];
  for (const [key, alt] of [['hero-laptop', 'Ноутбук'], ['hero-tablet', 'Планшет'], ['hero-phone', 'Смартфон'], ['hero-watch', 'Смарт-часы'], ['hero-earbuds', 'Наушники'], ['hero-controller', 'Геймпад'], ['hero-camera', 'Камера'], ['hero-printer', 'Принтер']] as const) {
    const id = await image(key);
    const asset = id ? await prisma.mediaAsset.findUnique({ where: { id } }) : null;
    if (asset) heroImages.push({ key, url: (asset.variants as Record<string, string>).card ?? asset.publicUrl, alt });
  }
  await prisma.siteSetting.upsert({ where: { key: 'hero_images' }, create: { key: 'hero_images', value: heroImages }, update: { value: heroImages } });
  for (const b of BANNERS) {
    const imageAssetId = await image(b.image);
    const existing = await prisma.banner.findFirst({ where: { placement: b.placement, title: b.title } });
    const data = { placement: b.placement, theme: b.theme, title: b.title, subtitle: b.subtitle, ctaLabel: b.ctaLabel, ctaUrl: b.ctaUrl, imageAssetId, handwrittenNote: 'handwrittenNote' in b ? b.handwrittenNote : null, sortOrder: b.sortOrder, isActive: true };
    if (existing) await prisma.banner.update({ where: { id: existing.id }, data });
    else await prisma.banner.create({ data });
  }
  for (const c of COLLECTIONS) {
    const col = await prisma.collection.upsert({ where: { slug: c.slug }, create: { slug: c.slug, name: c.name, type: c.type }, update: { name: c.name, type: c.type } });
    await prisma.collectionItem.deleteMany({ where: { collectionId: col.id } });
    const products = await prisma.product.findMany({ where: { slug: { in: [...c.products] } }, select: { id: true, slug: true } });
    await prisma.collectionItem.createMany({ data: c.products.map((slug, i) => ({ collectionId: col.id, productId: products.find((p) => p.slug === slug)?.id })).filter((x): x is { collectionId: string; productId: string; sortOrder?: number } => Boolean(x.productId)).map((x, i) => ({ ...x, sortOrder: i })) });
  }
  for (const [i, b] of BUNDLES.entries()) {
    const imageAssetId = await image(b.image);
    const bundle = await prisma.bundle.upsert({ where: { slug: b.slug }, create: { slug: b.slug, name: b.name, description: b.description, imageAssetId, discountPercent: b.discountPercent, sortOrder: i }, update: { name: b.name, description: b.description, imageAssetId, discountPercent: b.discountPercent, sortOrder: i } });
    await prisma.bundleItem.deleteMany({ where: { bundleId: bundle.id } });
    await prisma.bundleDevice.deleteMany({ where: { bundleId: bundle.id } });
    const variants = await prisma.productVariant.findMany({ where: { sku: { in: [...b.items] } } });
    await prisma.bundleItem.createMany({ data: b.items.map((sku, j) => ({ bundleId: bundle.id, variantId: variants.find((v) => v.sku === sku)!.id, sortOrder: j })) });
    const devices = await prisma.deviceModel.findMany({ where: { slug: { in: [...b.devices] } } });
    await prisma.bundleDevice.createMany({ data: devices.map((d) => ({ bundleId: bundle.id, deviceModelId: d.id })) });
  }
  for (const [i, p] of PROMOTIONS.entries()) {
    const category = 'category' in p ? await prisma.accessoryCategory.findUnique({ where: { slug: p.category } }) : null;
    const promo = await prisma.promotion.upsert({ where: { slug: p.slug }, create: { slug: p.slug, name: p.name, description: p.description, discountType: p.discountType, value: p.value, scope: p.scope, categoryId: category?.id ?? null, badgeLabel: 'badgeLabel' in p ? p.badgeLabel : null, sortOrder: i }, update: { name: p.name, description: p.description, discountType: p.discountType, value: p.value, scope: p.scope, categoryId: category?.id ?? null, sortOrder: i } });
    for (const c of 'coupons' in p ? p.coupons : []) {
      await prisma.coupon.upsert({ where: { code: c.code }, create: { code: c.code, promotionId: promo.id, discountType: p.discountType, value: c.value, minSubtotalMinor: c.minSubtotalMinor ?? 0, maxDiscountMinor: 'maxDiscountMinor' in c ? c.maxDiscountMinor : null, usageLimit: 'usageLimit' in c ? c.usageLimit : null, perCustomerLimit: 'perCustomerLimit' in c ? c.perCustomerLimit : null }, update: { promotionId: promo.id, value: c.value, minSubtotalMinor: c.minSubtotalMinor ?? 0 } });
    }
  }
  for (const f of FAQ) {
    const existing = await prisma.faqItem.findFirst({ where: { question: f.question } });
    if (!existing) await prisma.faqItem.create({ data: { question: f.question, answer: f.answer, category: f.category, sortOrder: f.sortOrder } });
  }
  for (const p of PAGES) await prisma.contentPage.upsert({ where: { slug: p.slug }, create: { slug: p.slug, title: p.title, body: p.body, sortOrder: p.sortOrder }, update: { title: p.title, body: p.body, sortOrder: p.sortOrder } });
  await prisma.externalSource.upsert({ where: { code: 'wildberries' }, create: { code: 'wildberries', type: 'WILDBERRIES', name: 'Wildberries', isActive: false }, update: {} });
  await prisma.externalSource.upsert({ where: { code: 'ozon' }, create: { code: 'ozon', type: 'OZON', name: 'Ozon', isActive: false }, update: {} });
  await prisma.externalSource.upsert({ where: { code: 'yandex-market' }, create: { code: 'yandex-market', type: 'YANDEX_MARKET', name: 'Яндекс Маркет', isActive: false }, update: {} });
  await prisma.externalSource.upsert({ where: { code: 'file-csv' }, create: { code: 'file-csv', type: 'CSV', name: 'Файлы CSV' }, update: {} });
  await prisma.externalSource.upsert({ where: { code: 'file-xlsx' }, create: { code: 'file-xlsx', type: 'XLSX', name: 'Файлы XLSX' }, update: {} });
}

async function seedCustomerAndOrder() {
  console.log('→ Клиент и пример заказа');
  const env = getEnv();
  const customer = await prisma.customer.upsert({ where: { email: env.SEED_CUSTOMER_EMAIL }, create: { email: env.SEED_CUSTOMER_EMAIL, passwordHash: hashPassword(env.SEED_CUSTOMER_PASSWORD), firstName: 'Ната', lastName: 'Демо', phone: '+7 900 000-00-00', isEmailVerified: true }, update: {} });
  const iphone = await prisma.deviceModel.findUniqueOrThrow({ where: { slug: 'apple-iphone-15-pro' } });
  const mac = await prisma.deviceModel.findUniqueOrThrow({ where: { slug: 'apple-macbook-air-m2-13' } });
  await prisma.customerDevice.upsert({ where: { customerId_deviceModelId_scopeKey: { customerId: customer.id, deviceModelId: iphone.id, scopeKey: '*' } }, create: { customerId: customer.id, deviceModelId: iphone.id, isPrimary: true }, update: {} });
  await prisma.customerDevice.upsert({ where: { customerId_deviceModelId_scopeKey: { customerId: customer.id, deviceModelId: mac.id, scopeKey: '*' } }, create: { customerId: customer.id, deviceModelId: mac.id }, update: {} });
  if ((await prisma.order.count({ where: { customerId: customer.id } })) === 0) {
    const charger = await prisma.productVariant.findUniqueOrThrow({ where: { sku: 'ANK-A2147' }, include: { product: { include: { images: { include: { asset: true }, take: 1 } } }, prices: { take: 1, orderBy: { validFrom: 'desc' } } } });
    const cable = await prisma.productVariant.findUniqueOrThrow({ where: { sku: 'UGR-10210-2M' }, include: { product: { include: { images: { include: { asset: true }, take: 1 } } }, prices: { take: 1, orderBy: { validFrom: 'desc' } } } });
    const subtotal = charger.prices[0]!.amountMinor + cable.prices[0]!.amountMinor;
    const order = await prisma.order.create({
      data: {
        publicId: generateOrderPublicId(new Date(Date.now() - 3 * 86_400_000)), customerId: customer.id, status: 'SHIPPED', email: customer.email, phone: customer.phone!, fullName: 'Ната Демо',
        shippingAddress: { fullName: 'Ната Демо', phone: customer.phone, email: customer.email, country: 'RU', city: 'Москва', street: 'Тверская', building: '1', apartment: '10', postalCode: '125009' },
        deliveryMethodCode: 'courier', deliveryProviderCode: 'mock', deliveryCostMinor: 0, subtotalMinor: subtotal, discountMinor: 0, totalMinor: subtotal, paidAt: new Date(Date.now() - 3 * 86_400_000 + 600_000), idempotencyKey: 'seed-demo-order-1',
        items: { create: [
          { productId: charger.productId, variantId: charger.id, name: charger.product.name, sku: charger.sku, imageUrl: charger.product.images[0]?.asset.publicUrl ?? null, quantity: 1, unitPriceMinor: charger.prices[0]!.amountMinor, totalMinor: charger.prices[0]!.amountMinor, deviceModelId: iphone.id, compatibilityStatus: 'COMPATIBLE' },
          { productId: cable.productId, variantId: cable.id, name: `${cable.product.name}`, sku: cable.sku, imageUrl: cable.product.images[0]?.asset.publicUrl ?? null, quantity: 1, unitPriceMinor: cable.prices[0]!.amountMinor, totalMinor: cable.prices[0]!.amountMinor, deviceModelId: iphone.id, compatibilityStatus: 'COMPATIBLE' },
        ] },
        statusHistory: { create: [
          { fromStatus: null, toStatus: 'DRAFT', actorType: 'CUSTOMER', comment: 'Заказ создан', createdAt: new Date(Date.now() - 3 * 86_400_000) },
          { fromStatus: 'DRAFT', toStatus: 'PENDING_PAYMENT', actorType: 'SYSTEM', comment: 'Остатки зарезервированы', createdAt: new Date(Date.now() - 3 * 86_400_000 + 1000) },
          { fromStatus: 'PENDING_PAYMENT', toStatus: 'PAID', actorType: 'SYSTEM', comment: 'Оплата подтверждена (mock)', createdAt: new Date(Date.now() - 3 * 86_400_000 + 600_000) },
          { fromStatus: 'PAID', toStatus: 'PROCESSING', actorType: 'ADMIN', comment: 'Передан на сборку', createdAt: new Date(Date.now() - 2 * 86_400_000) },
          { fromStatus: 'PROCESSING', toStatus: 'READY_FOR_SHIPMENT', actorType: 'ADMIN', createdAt: new Date(Date.now() - 2 * 86_400_000 + 3_600_000) },
          { fromStatus: 'READY_FOR_SHIPMENT', toStatus: 'SHIPPED', actorType: 'ADMIN', comment: 'Отправление TM123456789', createdAt: new Date(Date.now() - 86_400_000) },
        ] },
        payments: { create: { provider: 'mock', providerPaymentId: 'mock_seed_payment_1', status: 'SUCCEEDED', amountMinor: subtotal, idempotencyKey: 'seed-demo-payment-1', metadata: { mode: 'mock' } } },
        shipments: { create: { provider: 'mock', providerShipmentId: 'mock_ship_seed1', trackingNumber: 'TM123456789', status: 'IN_TRANSIT', methodCode: 'courier', costMinor: 0, events: [{ at: new Date(Date.now() - 86_400_000).toISOString(), status: 'IN_TRANSIT', description: 'Передано курьеру' }] } },
      },
    });
    console.log(`  заказ ${order.publicId}`);
  }
  // Немного статистики поиска
  if ((await prisma.searchQueryLog.count()) === 0) {
    await prisma.searchQueryLog.createMany({ data: [
      { query: 'iPhone 15 Pro', normalized: 'iphone 15 pro', resultCount: 1, matchedDeviceModelId: iphone.id },
      { query: 'макбук эйр', normalized: 'macbook air', resultCount: 3 },
      { query: 'Huawei P60', normalized: 'huawei p 60', resultCount: 0 },
      { query: 'Huawei P60', normalized: 'huawei p 60', resultCount: 0 },
      { query: 'Kyocera M2040', normalized: 'kyocera m 2040', resultCount: 0 },
      { query: 'Redmi Note 13', normalized: 'redmi note 13', resultCount: 0 },
    ] });
  }
}

async function main() {
  const started = Date.now();
  await seedCore();
  await seedDevices();
  await seedCatalog();
  await seedCompatibility();
  await seedContent();
  await seedCustomerAndOrder();
  const [devices, products, relations] = await Promise.all([prisma.deviceModel.count(), prisma.product.count(), prisma.compatibilityRelation.count()]);
  console.log(`✓ Seed готов за ${((Date.now() - started) / 1000).toFixed(1)} с: устройств ${devices}, товаров ${products}, связей совместимости ${relations}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
