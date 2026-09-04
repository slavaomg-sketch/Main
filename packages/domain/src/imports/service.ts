import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from '@techmatch/config';
import type { DbClient, Prisma, PrismaClient } from '@techmatch/database';
import { stringify } from 'csv-stringify/sync';
import { applyMapping, buildXlsx, buildYmlFeed, pickImportAdapter, type CanonicalField, type CanonicalImportRow, guessMapping } from '@techmatch/integrations';
import { ConflictError, NotFoundError, ValidationError } from '../shared/errors.js';
import { slugify } from '../shared/slug.js';
import { buildProductSearchText } from '../catalog/service.js';
import { getDefaultWarehouse } from '../inventory/service.js';
import { storeImageFromUrl } from '../media/service.js';
import { invalidateCompatibilityCache } from '../compatibility/service.js';
import { writeAudit } from '../audit/service.js';

const IMPORT_DIR = resolve(REPO_ROOT, 'storage', 'imports');
const MAX_ROWS = 5000;

/** Поля, которыми может владеть источник; остальные (совместимость, SEO) — только вручную. */
export const OWNABLE_FIELDS = ['name', 'description', 'price', 'stock', 'images', 'brand', 'category'] as const;
export type OwnableField = (typeof OWNABLE_FIELDS)[number];

export interface ImportOptions {
  /** Поля, которыми управляет источник при обновлении существующих товаров. */
  sourceOwnedFields: OwnableField[];
  createMissing: boolean;
  activateCreated: boolean;
  downloadImages: boolean;
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = { sourceOwnedFields: ['price', 'stock'], createMissing: true, activateCreated: true, downloadImages: false };

export async function ensureFileSource(db: DbClient, type: 'CSV' | 'XLSX' | 'YML') {
  const code = `file-${type.toLowerCase()}`;
  return db.externalSource.upsert({ where: { code }, create: { code, type, name: `Файлы ${type}` }, update: {} });
}

export async function createImportJob(db: DbClient, input: { buffer: Buffer; fileName: string; mimeType?: string; sourceCode?: string | null; adminId?: string | null }) {
  const adapter = pickImportAdapter(input.fileName, input.mimeType);
  if (!adapter) throw new ValidationError('Поддерживаются файлы CSV, XLSX и YML/XML');
  const type = adapter.code.toUpperCase() as 'CSV' | 'XLSX' | 'YML';
  const source = input.sourceCode ? await db.externalSource.findUnique({ where: { code: input.sourceCode } }) : await ensureFileSource(db, type);
  if (!source) throw new NotFoundError('Источник', input.sourceCode ?? '');
  const fileHash = createHash('sha256').update(input.buffer).digest('hex');
  const table = await adapter.parse(input.buffer);
  if (table.headers.length === 0) throw new ValidationError('В файле не найдены заголовки столбцов');
  if (table.totalRows > MAX_ROWS) throw new ValidationError(`Слишком много строк (${table.totalRows}), максимум ${MAX_ROWS} за один импорт`);
  await mkdir(IMPORT_DIR, { recursive: true });
  const storageKey = `${fileHash.slice(0, 16)}-${Date.now()}${input.fileName.slice(input.fileName.lastIndexOf('.'))}`;
  await writeFile(join(IMPORT_DIR, storageKey), input.buffer);
  const previous = await db.importJob.findFirst({ where: { fileHash, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } });
  const mapping = guessMapping(table.headers);
  const job = await db.importJob.create({
    data: {
      sourceId: source.id,
      type,
      fileName: input.fileName,
      storageKey,
      fileHash,
      status: 'ANALYZED',
      mapping,
      options: DEFAULT_IMPORT_OPTIONS as unknown as Prisma.InputJsonValue,
      analysis: { headers: table.headers, sample: table.rows.slice(0, 5), totalRows: table.totalRows, sheetName: table.sheetName ?? null, previousJobId: previous?.id ?? null, previousJobAt: previous?.finishedAt ?? null },
      createdById: input.adminId ?? null,
      rows: { create: table.rows.map((raw, i) => ({ rowNumber: i + 1, rawData: raw })) },
    },
  });
  await writeAudit(db, { actorType: 'ADMIN', actorId: input.adminId, action: 'import.create', entityType: 'ImportJob', entityId: job.id, after: { fileName: input.fileName, rows: table.totalRows } });
  return job;
}

export async function setImportMapping(db: DbClient, jobId: string, mapping: Record<string, CanonicalField | ''>, options: Partial<ImportOptions>) {
  const job = await getImportJob(db, jobId);
  if (!['ANALYZED', 'MAPPED', 'VALIDATED', 'DRY_RUN_COMPLETE'].includes(job.status)) throw new ConflictError('Сопоставление можно менять только до применения');
  const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)) as Record<string, CanonicalField>;
  if (!Object.values(clean).includes('externalId')) throw new ValidationError('Укажите столбец с внешним ID');
  const opts = { ...DEFAULT_IMPORT_OPTIONS, ...(job.options as Partial<ImportOptions>), ...options };
  return db.importJob.update({ where: { id: jobId }, data: { mapping: clean, options: opts as unknown as Prisma.InputJsonValue, status: 'MAPPED' } });
}

export async function getImportJob(db: DbClient, jobId: string) {
  const job = await db.importJob.findUnique({ where: { id: jobId }, include: { source: true, createdBy: { select: { name: true, email: true } }, _count: { select: { rows: true, issues: true } } } });
  if (!job) throw new NotFoundError('Импорт', jobId);
  return job;
}

interface MatchResult {
  productId: string | null;
  variantId: string | null;
  via: 'listing' | 'sku' | 'gtin' | null;
}

async function matchRow(db: DbClient, sourceId: string, row: CanonicalImportRow): Promise<MatchResult> {
  const listing = await db.externalListing.findUnique({ where: { sourceId_externalId: { sourceId, externalId: row.externalId } } });
  if (listing?.variantId) return { productId: listing.productId, variantId: listing.variantId, via: 'listing' };
  if (row.sku) {
    const v = await db.productVariant.findUnique({ where: { sku: row.sku } });
    if (v) return { productId: v.productId, variantId: v.id, via: 'sku' };
  }
  if (row.gtin) {
    const v = await db.productVariant.findFirst({ where: { gtin: row.gtin } });
    if (v) return { productId: v.productId, variantId: v.id, via: 'gtin' };
  }
  return { productId: null, variantId: null, via: null };
}

async function ownedByManual(db: DbClient, productId: string, variantId: string | null, field: OwnableField): Promise<boolean> {
  const rows = await db.externalFieldOwnership.findMany({ where: { productId, field, OR: [{ scopeKey: '' }, { scopeKey: variantId ?? '' }] } });
  return rows.some((r) => r.owner === 'MANUAL');
}

/** Валидация + dry-run: заполняет normalizedData, action, diff и issues, не меняя каталог. */
export async function dryRunImport(db: PrismaClient, jobId: string) {
  const job = await getImportJob(db, jobId);
  if (!['MAPPED', 'VALIDATED', 'DRY_RUN_COMPLETE'].includes(job.status)) throw new ConflictError('Сначала задайте сопоставление столбцов');
  const mapping = job.mapping as Record<string, CanonicalField>;
  const options = { ...DEFAULT_IMPORT_OPTIONS, ...(job.options as Partial<ImportOptions>) };
  const rows = await db.importRow.findMany({ where: { jobId }, orderBy: { rowNumber: 'asc' } });
  await db.importIssue.deleteMany({ where: { jobId } });
  const summary = { create: 0, update: 0, skip: 0, conflict: 0, error: 0, total: rows.length };
  const seenExternal = new Map<string, number>();
  const issues: Prisma.ImportIssueCreateManyInput[] = [];

  for (const r of rows) {
    const { row, errors } = applyMapping(r.rawData as Record<string, string>, mapping);
    if (!row) {
      summary.error += 1;
      issues.push(...errors.map((m) => ({ jobId, rowId: r.id, level: 'ERROR' as const, code: 'INVALID_ROW', message: m })));
      await db.importRow.update({ where: { id: r.id }, data: { action: 'ERROR', message: errors.join('; '), normalizedData: undefined } });
      continue;
    }
    const dup = seenExternal.get(row.externalId);
    if (dup) {
      summary.conflict += 1;
      issues.push({ jobId, rowId: r.id, level: 'ERROR', code: 'DUPLICATE_IN_FILE', message: `Внешний ID «${row.externalId}» уже встречался в строке ${dup}` });
      await db.importRow.update({ where: { id: r.id }, data: { action: 'CONFLICT', externalId: row.externalId, normalizedData: row as object, message: `Дубликат строки ${dup}` } });
      continue;
    }
    seenExternal.set(row.externalId, r.rowNumber);
    for (const w of errors) issues.push({ jobId, rowId: r.id, level: 'WARNING', code: 'FIELD_WARNING', message: w });

    const match = await matchRow(db, job.sourceId!, row);
    if (!match.variantId) {
      if (!options.createMissing) {
        summary.skip += 1;
        await db.importRow.update({ where: { id: r.id }, data: { action: 'SKIP', externalId: row.externalId, normalizedData: row as object, message: 'Товар не найден, создание отключено' } });
        continue;
      }
      if (!row.name) {
        summary.error += 1;
        issues.push({ jobId, rowId: r.id, level: 'ERROR', code: 'NAME_REQUIRED', message: 'Для нового товара нужно название' });
        await db.importRow.update({ where: { id: r.id }, data: { action: 'ERROR', externalId: row.externalId, normalizedData: row as object, message: 'Нет названия' } });
        continue;
      }
      if (row.priceMinor === undefined) issues.push({ jobId, rowId: r.id, level: 'WARNING', code: 'NO_PRICE', message: 'Нет цены: товар будет создан черновиком без цены' });
      summary.create += 1;
      await db.importRow.update({ where: { id: r.id }, data: { action: 'CREATE', externalId: row.externalId, normalizedData: row as object, diff: { create: row } as object, message: null } });
      continue;
    }
    // Конфликт: SKU/GTIN совпал с товаром, привязанным к другому листингу того же источника
    if (match.via !== 'listing') {
      const other = await db.externalListing.findFirst({ where: { sourceId: job.sourceId!, variantId: match.variantId, externalId: { not: row.externalId } } });
      if (other) {
        summary.conflict += 1;
        issues.push({ jobId, rowId: r.id, level: 'ERROR', code: 'LISTING_CONFLICT', message: `Товар уже связан с внешним ID «${other.externalId}» этого источника` });
        await db.importRow.update({ where: { id: r.id }, data: { action: 'CONFLICT', externalId: row.externalId, normalizedData: row as object, matchedProductId: match.productId, matchedVariantId: match.variantId, message: 'Конфликт привязки' } });
        continue;
      }
    }
    const diff = await computeDiff(db, match, row, options);
    if (Object.keys(diff.changes).length === 0) {
      summary.skip += 1;
      await db.importRow.update({ where: { id: r.id }, data: { action: 'SKIP', externalId: row.externalId, normalizedData: row as object, matchedProductId: match.productId, matchedVariantId: match.variantId, diff: diff as object, message: 'Изменений нет' } });
    } else {
      summary.update += 1;
      for (const f of diff.protectedFields) issues.push({ jobId, rowId: r.id, level: 'INFO', code: 'MANUAL_FIELD', message: `Поле «${f}» отредактировано вручную и не будет перезаписано` });
      await db.importRow.update({ where: { id: r.id }, data: { action: 'UPDATE', externalId: row.externalId, normalizedData: row as object, matchedProductId: match.productId, matchedVariantId: match.variantId, diff: diff as object, message: null } });
    }
  }
  if (issues.length) await db.importIssue.createMany({ data: issues });
  return db.importJob.update({ where: { id: jobId }, data: { status: 'DRY_RUN_COMPLETE', summary }, include: { source: true } });
}

interface DiffResult {
  changes: Record<string, { from: unknown; to: unknown }>;
  protectedFields: string[];
}

async function computeDiff(db: DbClient, match: MatchResult, row: CanonicalImportRow, options: ImportOptions): Promise<DiffResult> {
  const variant = await db.productVariant.findUnique({ where: { id: match.variantId! }, include: { product: true, prices: { where: { priceList: 'retail' }, orderBy: { validFrom: 'desc' }, take: 1 }, inventory: true } });
  const changes: DiffResult['changes'] = {};
  const protectedFields: string[] = [];
  if (!variant) return { changes, protectedFields };
  const consider = async (field: OwnableField, from: unknown, to: unknown) => {
    if (to === undefined || JSON.stringify(from) === JSON.stringify(to)) return;
    if (!options.sourceOwnedFields.includes(field)) return;
    if (await ownedByManual(db, variant.productId, variant.id, field)) {
      protectedFields.push(field);
      return;
    }
    changes[field] = { from, to };
  };
  await consider('name', variant.product.name, row.name);
  await consider('description', variant.product.description, row.description);
  await consider('price', variant.prices[0]?.amountMinor, row.priceMinor);
  await consider('stock', variant.inventory.reduce((s, i) => s + i.quantity, 0), row.stock);
  if (row.imageUrls?.length) await consider('images', null, row.imageUrls);
  return { changes, protectedFields };
}

/** Идемпотентное применение: повторный запуск того же файла не создаёт дублей (совпадение по ExternalListing/SKU/GTIN). */
export async function applyImport(db: PrismaClient, jobId: string, adminId?: string | null) {
  const job = await getImportJob(db, jobId);
  if (job.status !== 'DRY_RUN_COMPLETE') throw new ConflictError('Сначала выполните предварительный просмотр (dry-run)');
  const options = { ...DEFAULT_IMPORT_OPTIONS, ...(job.options as Partial<ImportOptions>) };
  await db.importJob.update({ where: { id: jobId }, data: { status: 'APPLYING', startedAt: new Date() } });
  const run = await db.syncRun.create({ data: { sourceId: job.sourceId!, jobId, status: 'RUNNING' } });
  const rows = await db.importRow.findMany({ where: { jobId, action: { in: ['CREATE', 'UPDATE'] }, appliedAt: null }, orderBy: { rowNumber: 'asc' } });
  const stats = { created: 0, updated: 0, failed: 0, images: 0 };
  const warehouse = await getDefaultWarehouse(db);
  const otherCategory = await db.accessoryCategory.upsert({ where: { slug: 'other' }, create: { slug: 'other', name: 'Другие аксессуары', sortOrder: 999 }, update: {} });

  for (const r of rows) {
    const row = r.normalizedData as unknown as CanonicalImportRow;
    try {
      await db.$transaction(async (tx) => {
        let productId = r.matchedProductId;
        let variantId = r.matchedVariantId;
        if (r.action === 'CREATE') {
          const brand = row.brand ? await tx.productBrand.upsert({ where: { slug: slugify(row.brand) }, create: { slug: slugify(row.brand), name: row.brand }, update: {} }) : null;
          const category = row.category ? ((await tx.accessoryCategory.findFirst({ where: { OR: [{ slug: slugify(row.category) }, { name: { equals: row.category, mode: 'insensitive' } }] } })) ?? otherCategory) : otherCategory;
          let slug = slugify(`${row.brand ?? ''} ${row.name!}`) || `product-${row.externalId}`;
          if (await tx.product.findUnique({ where: { slug } })) slug = `${slug}-${row.externalId.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
          const sku = row.sku ?? `${job.source!.code.toUpperCase()}-${row.externalId}`;
          const product = await tx.product.create({
            data: {
              slug,
              name: row.name!,
              brandId: brand?.id ?? null,
              categoryId: category.id,
              status: options.activateCreated && row.priceMinor !== undefined ? 'ACTIVE' : 'DRAFT',
              description: row.description ?? null,
              baseSku: sku,
              searchText: buildProductSearchText({ name: row.name!, brandName: brand?.name, categoryName: category.name, skus: [sku] }),
              variants: { create: { sku, name: row.name!, isDefault: true, gtin: row.gtin ?? null } },
            },
            include: { variants: true },
          });
          productId = product.id;
          variantId = product.variants[0]!.id;
          if (row.priceMinor !== undefined) await tx.price.create({ data: { variantId, amountMinor: row.priceMinor, compareAtMinor: row.compareAtMinor ?? null } });
          await tx.inventory.create({ data: { variantId, warehouseId: warehouse.id, quantity: row.stock ?? 0 } });
          for (const f of options.sourceOwnedFields) await tx.externalFieldOwnership.upsert({ where: { productId_scopeKey_field: { productId, scopeKey: '', field: f } }, create: { productId, field: f, owner: 'SOURCE', sourceId: job.sourceId }, update: { owner: 'SOURCE', sourceId: job.sourceId } });
          stats.created += 1;
        } else {
          const diff = (r.diff as DiffResult | null)?.changes ?? {};
          if (diff.name) await tx.product.update({ where: { id: productId! }, data: { name: String(diff.name.to) } });
          if (diff.description) await tx.product.update({ where: { id: productId! }, data: { description: String(diff.description.to) } });
          if (diff.price) {
            await tx.price.updateMany({ where: { variantId: variantId!, priceList: 'retail', validTo: null }, data: { validTo: new Date() } });
            await tx.price.create({ data: { variantId: variantId!, amountMinor: Number(diff.price.to), compareAtMinor: row.compareAtMinor ?? null } });
          }
          if (diff.stock) await tx.inventory.upsert({ where: { variantId_warehouseId: { variantId: variantId!, warehouseId: warehouse.id } }, create: { variantId: variantId!, warehouseId: warehouse.id, quantity: Number(diff.stock.to) }, update: { quantity: Number(diff.stock.to) } });
          stats.updated += 1;
        }
        await tx.externalListing.upsert({
          where: { sourceId_externalId: { sourceId: job.sourceId!, externalId: row.externalId } },
          create: { sourceId: job.sourceId!, externalId: row.externalId, sku: row.sku ?? null, gtin: row.gtin ?? null, externalUrl: row.externalUrl ?? null, rawPayload: r.rawData as object, status: 'LINKED', productId, variantId, lastSyncedAt: new Date() },
          update: { sku: row.sku ?? null, gtin: row.gtin ?? null, externalUrl: row.externalUrl ?? null, rawPayload: r.rawData as object, status: 'UPDATED', productId, variantId, lastSyncedAt: new Date(), errors: [] },
        });
        // Совместимость из файла: связи с source=IMPORT, статус COMPATIBLE (подтверждает администратор)
        if (row.compatibleDevices?.length && productId) {
          const devices = await tx.deviceModel.findMany({ where: { slug: { in: row.compatibleDevices } }, select: { id: true } });
          for (const d of devices) {
            await tx.compatibilityRelation.upsert({
              where: { productId_deviceModelId_scopeKey: { productId, deviceModelId: d.id, scopeKey: '*:*' } },
              create: { productId, deviceModelId: d.id, scopeKey: '*:*', status: 'COMPATIBLE', source: 'IMPORT', confidence: 0.8, reasons: ['Указано в файле импорта'] },
              update: {},
            });
          }
        }
        await tx.importRow.update({ where: { id: r.id }, data: { appliedAt: new Date(), matchedProductId: productId, matchedVariantId: variantId } });
      }, { timeout: 30_000 });
      // Изображения — вне транзакции, best-effort
      if (options.downloadImages && row.imageUrls?.length && r.action === 'CREATE') {
        const productId = (await db.importRow.findUnique({ where: { id: r.id } }))!.matchedProductId!;
        for (const [i, url] of row.imageUrls.slice(0, 5).entries()) {
          try {
            const asset = await storeImageFromUrl(db, url, { source: 'IMPORT' });
            await db.productImage.create({ data: { productId, assetId: asset.id, sortOrder: i, isPrimary: i === 0 } });
            stats.images += 1;
          } catch (e) {
            await db.importIssue.create({ data: { jobId, rowId: r.id, level: 'WARNING', code: 'IMAGE_FAILED', message: `Изображение ${url}: ${(e as Error).message}` } });
          }
        }
      }
    } catch (e) {
      stats.failed += 1;
      await db.importRow.update({ where: { id: r.id }, data: { action: 'ERROR', message: (e as Error).message.slice(0, 500) } });
      await db.importIssue.create({ data: { jobId, rowId: r.id, level: 'ERROR', code: 'APPLY_FAILED', message: (e as Error).message.slice(0, 500) } });
    }
  }
  invalidateCompatibilityCache();
  const finished = await db.importJob.update({ where: { id: jobId }, data: { status: stats.failed && !stats.created && !stats.updated ? 'FAILED' : 'COMPLETED', finishedAt: new Date(), summary: { ...(job.summary as object), applied: stats } } });
  await db.syncRun.update({ where: { id: run.id }, data: { status: stats.failed ? 'PARTIAL' : 'SUCCEEDED', finishedAt: new Date(), stats } });
  await db.externalSource.update({ where: { id: job.sourceId! }, data: { lastSyncAt: new Date() } });
  await writeAudit(db, { actorType: 'ADMIN', actorId: adminId, action: 'import.apply', entityType: 'ImportJob', entityId: jobId, after: stats });
  return finished;
}

export async function listImportJobs(db: DbClient, limit = 50) {
  return db.importJob.findMany({ orderBy: { createdAt: 'desc' }, take: limit, include: { source: true, createdBy: { select: { name: true } }, _count: { select: { rows: true, issues: true } } } });
}

export async function listImportRows(db: DbClient, jobId: string, opts: { action?: string | null; page?: number; perPage?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(200, opts.perPage ?? 50);
  const where: Prisma.ImportRowWhereInput = { jobId, ...(opts.action ? { action: opts.action as Prisma.ImportRowWhereInput['action'] } : {}) };
  const [items, total] = await Promise.all([db.importRow.findMany({ where, orderBy: { rowNumber: 'asc' }, skip: (page - 1) * perPage, take: perPage, include: { issues: true } }), db.importRow.count({ where })]);
  return { items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
}

export async function setFieldOwner(db: DbClient, productId: string, field: OwnableField, owner: 'MANUAL' | 'SOURCE', variantId?: string | null) {
  return db.externalFieldOwnership.upsert({
    where: { productId_scopeKey_field: { productId, scopeKey: variantId ?? '', field } },
    create: { productId, variantId: variantId ?? null, scopeKey: variantId ?? '', field, owner },
    update: { owner },
  });
}

export async function readImportFile(job: { storageKey: string | null }) {
  if (!job.storageKey) throw new NotFoundError('Файл импорта');
  return readFile(join(IMPORT_DIR, job.storageKey));
}

// ---------------- Экспорт ----------------

async function exportRows(db: DbClient) {
  const variants = await db.productVariant.findMany({
    where: { product: { status: 'ACTIVE' } },
    include: { product: { include: { brand: true, category: true, images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 3, include: { asset: true } }, relations: { where: { isActive: true, status: { in: ['VERIFIED', 'COMPATIBLE', 'COMPATIBLE_WITH_LIMITATIONS'] } }, include: { deviceModel: { select: { slug: true } } } } } }, prices: { where: { priceList: 'retail', validTo: null }, orderBy: { validFrom: 'desc' }, take: 1 }, inventory: true, externalListings: true },
    orderBy: { sku: 'asc' },
  });
  return variants.map((v) => ({
    sku: v.sku,
    externalIds: v.externalListings.map((l) => l.externalId).join(';'),
    name: `${v.product.name}${v.name !== v.product.name ? ` — ${v.name}` : ''}`,
    brand: v.product.brand?.name ?? '',
    category: v.product.category.slug,
    price: v.prices[0] ? (v.prices[0].amountMinor / 100).toFixed(2) : '',
    oldPrice: v.prices[0]?.compareAtMinor ? (v.prices[0].compareAtMinor / 100).toFixed(2) : '',
    stock: v.inventory.reduce((s, i) => s + i.quantity, 0),
    gtin: v.gtin ?? '',
    images: v.product.images.map((i) => i.asset.publicUrl).join(';'),
    compatibleDevices: v.product.relations.map((r) => r.deviceModel.slug).join(';'),
    productSlug: v.product.slug,
    variantId: v.id,
  }));
}

export async function exportCatalogCsv(db: DbClient): Promise<string> {
  const rows = await exportRows(db);
  return '﻿' + stringify(rows, { header: true, delimiter: ';' });
}

export async function exportCatalogXlsx(db: DbClient): Promise<Buffer> {
  return buildXlsx(await exportRows(db), 'Каталог');
}

export async function exportPricesStocksCsv(db: DbClient): Promise<string> {
  const rows = await exportRows(db);
  return '﻿' + stringify(rows.map((r) => ({ sku: r.sku, externalIds: r.externalIds, price: r.price, oldPrice: r.oldPrice, stock: r.stock })), { header: true, delimiter: ';' });
}

export async function exportCompatibilityCsv(db: DbClient): Promise<string> {
  const rels = await db.compatibilityRelation.findMany({ where: { isActive: true }, include: { product: { select: { slug: true, name: true } }, deviceModel: { select: { slug: true, name: true } } }, orderBy: [{ productId: 'asc' }, { deviceModelId: 'asc' }] });
  return '﻿' + stringify(rels.map((r) => ({ productSlug: r.product.slug, product: r.product.name, deviceSlug: r.deviceModel.slug, device: r.deviceModel.name, status: r.status, source: r.source, confidence: r.confidence, reasons: (r.reasons as string[]).join(' | '), limitations: (r.limitations as string[]).join(' | '), verifiedAt: r.verifiedAt?.toISOString() ?? '' })), { header: true, delimiter: ';' });
}

export async function exportYml(db: DbClient, appUrl: string): Promise<string> {
  const rows = await exportRows(db);
  const categories = await db.accessoryCategory.findMany({ where: { isActive: true } });
  return buildYmlFeed({
    shopName: 'TechMatch',
    company: 'TechMatch',
    url: appUrl,
    categories: categories.map((c) => ({ id: c.slug, name: c.name, parentId: c.parentId ? categories.find((p) => p.id === c.parentId)?.slug : undefined })),
    offers: rows.filter((r) => r.price).map((r) => ({ id: r.sku, url: `${appUrl}/product/${r.productSlug}`, price: Number(r.price), oldPrice: r.oldPrice ? Number(r.oldPrice) : undefined, currency: 'RUR', categoryId: r.category, pictures: r.images ? r.images.split(';').map((u) => (u.startsWith('http') ? u : `${appUrl}${u}`)) : [], name: r.name, vendor: r.brand || undefined, vendorCode: r.sku, barcode: r.gtin || undefined, available: r.stock > 0, count: r.stock })),
  });
}
