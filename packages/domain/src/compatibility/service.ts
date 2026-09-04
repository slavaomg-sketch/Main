import type { DbClient } from '@techmatch/database';
import { NotFoundError } from '../shared/errors.js';
import { evaluateCompatibility, isPositiveStatus } from './engine.js';
import { buildDeviceProfile, buildProductProfile } from './profiles.js';
import type {
  CompatibilityResult,
  CompatibilityStatus,
  ConstraintSpec,
  DeviceSpecProfile,
  ExplicitRelationInput,
  OverrideInput,
  ProductSpecProfile,
} from './types.js';
import { ENGINE_VERSION } from './types.js';

const CACHE_TTL_MS = 60_000;
const catalogCache = new Map<string, { at: number; results: Map<string, CompatibilityResult> }>();

export function invalidateCompatibilityCache(): void {
  catalogCache.clear();
}

export const deviceProfileInclude = {
  category: { select: { slug: true } },
  specifications: { select: { key: true, value: true, variantId: true } },
} as const;

export const productProfileInclude = {
  category: { select: { slug: true } },
  attributes: { select: { value: true, variantId: true, attribute: { select: { code: true } } } },
} as const;

export async function loadDeviceProfile(db: DbClient, deviceModelId: string, deviceVariantId?: string | null): Promise<DeviceSpecProfile> {
  const row = await db.deviceModel.findUnique({
    where: { id: deviceModelId },
    select: { slug: true, name: true, releaseYear: true, specsAreDemo: true, ...deviceProfileInclude },
  });
  if (!row) throw new NotFoundError('Устройство', deviceModelId);
  return buildDeviceProfile(row, deviceVariantId);
}

export async function loadProductProfile(db: DbClient, productId: string, variantId?: string | null): Promise<ProductSpecProfile> {
  const row = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, slug: true, name: true, ...productProfileInclude },
  });
  if (!row) throw new NotFoundError('Товар', productId);
  return buildProductProfile(row, variantId);
}

interface StoredRelation {
  status: CompatibilityStatus;
  source: string;
  confidence: number;
  reasons: unknown;
  limitations: unknown;
  verifiedAt: Date | null;
  evidence: Array<{ type: string; url: string | null; note: string | null }>;
  constraints: Array<{ kind: string; description: string; params: unknown }>;
}

function toExplicitInput(rel: StoredRelation): ExplicitRelationInput {
  return {
    status: rel.status,
    source: rel.source as ExplicitRelationInput['source'],
    confidence: rel.confidence,
    reasons: Array.isArray(rel.reasons) ? (rel.reasons as string[]) : [],
    limitations: Array.isArray(rel.limitations) ? (rel.limitations as string[]) : [],
    constraints: rel.constraints.map((c) => ({ kind: c.kind as ConstraintSpec['kind'], description: c.description, params: (c.params ?? {}) as Record<string, unknown> })),
    verifiedAt: rel.verifiedAt,
    evidence: rel.evidence,
  };
}

const scopeKey = (variantId?: string | null, deviceVariantId?: string | null) => `${variantId ?? '*'}:${deviceVariantId ?? '*'}`;

async function loadExplicitAndOverride(db: DbClient, productId: string, deviceModelId: string, deviceVariantId?: string | null, variantId?: string | null) {
  const [relations, overrides] = await Promise.all([
    db.compatibilityRelation.findMany({
      where: { productId, deviceModelId, isActive: true, source: { in: ['EXPLICIT', 'MANUFACTURER', 'IMPORT'] } },
      include: { evidence: { select: { type: true, url: true, note: true } }, constraints: { select: { kind: true, description: true, params: true } } },
    }),
    db.compatibilityOverride.findMany({ where: { productId, deviceModelId, isActive: true } }),
  ]);
  const keys = [scopeKey(variantId, deviceVariantId), scopeKey(variantId, null), scopeKey(null, deviceVariantId), scopeKey(null, null)];
  const rel = keys.map((k) => relations.find((r) => r.scopeKey === k)).find(Boolean);
  const ovKeys = [deviceVariantId ?? '*', '*'];
  const ov = ovKeys.map((k) => overrides.find((o) => o.scopeKey === k)).find(Boolean);
  return {
    explicit: rel ? toExplicitInput(rel as unknown as StoredRelation) : null,
    override: ov ? ({ status: ov.status, reason: ov.reason } satisfies OverrideInput) : null,
  };
}

export interface CheckInput {
  productId: string;
  deviceModelId: string;
  deviceVariantId?: string | null;
  variantId?: string | null;
  log?: boolean;
}

/** Серверная проверка совместимости одного товара с одним устройством (источник истины). */
export async function checkCompatibility(db: DbClient, input: CheckInput): Promise<CompatibilityResult> {
  const started = Date.now();
  const [device, product, extra] = await Promise.all([
    loadDeviceProfile(db, input.deviceModelId, input.deviceVariantId),
    loadProductProfile(db, input.productId, input.variantId),
    loadExplicitAndOverride(db, input.productId, input.deviceModelId, input.deviceVariantId, input.variantId),
  ]);
  const result = evaluateCompatibility(device, product, extra);
  if (input.log) {
    await db.compatibilityCheckLog.create({
      data: {
        productId: input.productId,
        deviceModelId: input.deviceModelId,
        deviceVariantId: input.deviceVariantId ?? null,
        status: result.status,
        confidence: result.confidence,
        source: result.source,
        reasons: result.reasons,
        rulesApplied: result.rulesApplied,
        durationMs: Date.now() - started,
      },
    });
  }
  return result;
}

export interface CatalogEvaluation {
  device: DeviceSpecProfile;
  results: Map<string, CompatibilityResult>;
}

/**
 * Оценивает все активные товары для устройства. Результат кешируется в памяти (TTL 60 с)
 * и сохраняется в CompatibilityRelation с source=RULE (для аналитики и админки).
 */
export async function evaluateDeviceCatalog(
  db: DbClient,
  deviceModelId: string,
  opts: { deviceVariantId?: string | null; persist?: boolean; force?: boolean } = {},
): Promise<CatalogEvaluation> {
  const cacheKey = `${deviceModelId}:${opts.deviceVariantId ?? '*'}:v${ENGINE_VERSION}`;
  const cached = catalogCache.get(cacheKey);
  const device = await loadDeviceProfile(db, deviceModelId, opts.deviceVariantId);
  if (cached && !opts.force && Date.now() - cached.at < CACHE_TTL_MS) {
    return { device, results: cached.results };
  }
  const [products, relations, overrides] = await Promise.all([
    db.product.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true, name: true, ...productProfileInclude },
    }),
    db.compatibilityRelation.findMany({
      where: { deviceModelId, isActive: true, source: { in: ['EXPLICIT', 'MANUFACTURER', 'IMPORT'] } },
      include: { evidence: { select: { type: true, url: true, note: true } }, constraints: { select: { kind: true, description: true, params: true } } },
    }),
    db.compatibilityOverride.findMany({ where: { deviceModelId, isActive: true } }),
  ]);
  const wanted = [scopeKey(null, opts.deviceVariantId), scopeKey(null, null)];
  const results = new Map<string, CompatibilityResult>();
  for (const p of products) {
    const profile = buildProductProfile(p);
    const rel = wanted.map((k) => relations.find((r) => r.productId === p.id && r.scopeKey === k)).find(Boolean);
    const ov = [opts.deviceVariantId ?? '*', '*'].map((k) => overrides.find((o) => o.productId === p.id && o.scopeKey === k)).find(Boolean);
    results.set(
      p.id,
      evaluateCompatibility(device, profile, {
        explicit: rel ? toExplicitInput(rel as unknown as StoredRelation) : null,
        override: ov ? { status: ov.status, reason: ov.reason } : null,
      }),
    );
  }
  catalogCache.set(cacheKey, { at: Date.now(), results });
  if (opts.persist) await persistRuleRelations(db, deviceModelId, opts.deviceVariantId ?? null, results);
  return { device, results };
}

async function persistRuleRelations(db: DbClient, deviceModelId: string, deviceVariantId: string | null, results: Map<string, CompatibilityResult>) {
  const key = scopeKey(null, deviceVariantId);
  const existing = await db.compatibilityRelation.findMany({
    where: { deviceModelId, scopeKey: key, source: 'RULE' },
    select: { id: true, productId: true, status: true, confidence: true },
  });
  const byProduct = new Map(existing.map((e) => [e.productId, e]));
  for (const [productId, r] of results) {
    if (r.source !== 'RULE') continue;
    const prev = byProduct.get(productId);
    const data = {
      status: r.status,
      confidence: r.confidence,
      reasons: r.reasons,
      limitations: r.limitations,
      rulesApplied: r.rulesApplied,
      explanation: r.explanation,
    };
    if (!prev) {
      await db.compatibilityRelation.upsert({
        where: { productId_deviceModelId_scopeKey: { productId, deviceModelId, scopeKey: key } },
        create: { productId, deviceModelId, deviceVariantId, scopeKey: key, source: 'RULE', ...data },
        update: { ...data, source: 'RULE' },
      });
    } else if (prev.status !== r.status || Math.abs(prev.confidence - r.confidence) > 0.001) {
      await db.compatibilityRelation.update({ where: { id: prev.id }, data });
    }
  }
}

/** Список подходящих устройств для страницы товара. */
export async function listCompatibleDevicesForProduct(db: DbClient, productId: string, opts: { limit?: number } = {}) {
  const product = await loadProductProfile(db, productId);
  const devices = await db.deviceModel.findMany({
    where: { isActive: true },
    select: { id: true, slug: true, name: true, fullName: true, releaseYear: true, specsAreDemo: true, imageUrl: true, brand: { select: { name: true } }, ...deviceProfileInclude },
    orderBy: { popularity: 'desc' },
  });
  const relations = await db.compatibilityRelation.findMany({
    where: { productId, isActive: true, source: { in: ['EXPLICIT', 'MANUFACTURER', 'IMPORT'] } },
    include: { evidence: { select: { type: true, url: true, note: true } }, constraints: { select: { kind: true, description: true, params: true } } },
  });
  const overrides = await db.compatibilityOverride.findMany({ where: { productId, isActive: true } });
  const out: Array<{ device: (typeof devices)[number]; result: CompatibilityResult }> = [];
  for (const d of devices) {
    const rel = relations.find((r) => r.deviceModelId === d.id && r.scopeKey === '*:*');
    const ov = overrides.find((o) => o.deviceModelId === d.id && o.scopeKey === '*');
    const result = evaluateCompatibility(buildDeviceProfile(d), product, {
      explicit: rel ? toExplicitInput(rel as unknown as StoredRelation) : null,
      override: ov ? { status: ov.status, reason: ov.reason } : null,
    });
    if (isPositiveStatus(result.status)) out.push({ device: d, result });
  }
  out.sort((a, b) => b.result.confidence - a.result.confidence);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

// -------------------- Администрирование --------------------

export interface ExplicitRelationWrite {
  productId: string;
  deviceModelId: string;
  deviceVariantId?: string | null;
  variantId?: string | null;
  status: CompatibilityStatus;
  source?: 'EXPLICIT' | 'MANUFACTURER' | 'IMPORT';
  reasons?: string[];
  limitations?: string[];
  explanation?: string;
  confidence?: number;
  adminId?: string | null;
  evidence?: Array<{ type: 'MANUFACTURER_DOC' | 'SPEC_MATCH' | 'ADMIN_CONFIRMED' | 'CUSTOMER_REPORT' | 'IMPORT_SOURCE' | 'LAB_TEST'; url?: string; note?: string }>;
  constraints?: Array<{ kind: ConstraintSpec['kind']; description: string; requiredProductId?: string | null; params?: Record<string, unknown> }>;
}

export async function upsertExplicitRelation(db: DbClient, input: ExplicitRelationWrite) {
  const key = scopeKey(input.variantId, input.deviceVariantId);
  const rel = await db.compatibilityRelation.upsert({
    where: { productId_deviceModelId_scopeKey: { productId: input.productId, deviceModelId: input.deviceModelId, scopeKey: key } },
    create: {
      productId: input.productId,
      deviceModelId: input.deviceModelId,
      deviceVariantId: input.deviceVariantId ?? null,
      variantId: input.variantId ?? null,
      scopeKey: key,
      status: input.status,
      source: input.source ?? 'EXPLICIT',
      confidence: input.confidence ?? (input.status === 'VERIFIED' ? 1 : 0.9),
      reasons: input.reasons ?? [],
      limitations: input.limitations ?? [],
      explanation: input.explanation ?? null,
      verifiedAt: input.status === 'VERIFIED' ? new Date() : null,
      verifiedById: input.status === 'VERIFIED' ? input.adminId ?? null : null,
      isActive: true,
    },
    update: {
      status: input.status,
      source: input.source ?? 'EXPLICIT',
      confidence: input.confidence ?? (input.status === 'VERIFIED' ? 1 : 0.9),
      reasons: input.reasons ?? [],
      limitations: input.limitations ?? [],
      explanation: input.explanation ?? null,
      verifiedAt: input.status === 'VERIFIED' ? new Date() : null,
      verifiedById: input.status === 'VERIFIED' ? input.adminId ?? null : null,
      isActive: true,
    },
  });
  if (input.evidence?.length) {
    await db.compatibilityEvidence.createMany({
      data: input.evidence.map((e) => ({ relationId: rel.id, type: e.type, url: e.url ?? null, note: e.note ?? null, createdById: input.adminId ?? null })),
    });
  }
  if (input.constraints) {
    await db.compatibilityConstraint.deleteMany({ where: { relationId: rel.id } });
    if (input.constraints.length) {
      await db.compatibilityConstraint.createMany({
        data: input.constraints.map((c) => ({ relationId: rel.id, kind: c.kind, description: c.description, requiredProductId: c.requiredProductId ?? null, params: (c.params ?? {}) as object })),
      });
    }
  }
  invalidateCompatibilityCache();
  return rel;
}

export async function setCompatibilityOverride(db: DbClient, input: { productId: string; deviceModelId: string; deviceVariantId?: string | null; status: CompatibilityStatus; reason: string; adminId?: string | null }) {
  const key = input.deviceVariantId ?? '*';
  const ov = await db.compatibilityOverride.upsert({
    where: { productId_deviceModelId_scopeKey: { productId: input.productId, deviceModelId: input.deviceModelId, scopeKey: key } },
    create: { productId: input.productId, deviceModelId: input.deviceModelId, deviceVariantId: input.deviceVariantId ?? null, scopeKey: key, status: input.status, reason: input.reason, adminId: input.adminId ?? null },
    update: { status: input.status, reason: input.reason, adminId: input.adminId ?? null, isActive: true },
  });
  invalidateCompatibilityCache();
  return ov;
}

export async function removeCompatibilityOverride(db: DbClient, id: string) {
  await db.compatibilityOverride.update({ where: { id }, data: { isActive: false } });
  invalidateCompatibilityCache();
}

export async function deactivateRelation(db: DbClient, id: string) {
  await db.compatibilityRelation.update({ where: { id }, data: { isActive: false } });
  invalidateCompatibilityCache();
}

/** Товары без единой подтверждённой (EXPLICIT/MANUFACTURER, VERIFIED) связи — для дашборда. */
export async function listProductsWithoutVerifiedCompatibility(db: DbClient, limit = 50) {
  const verified = await db.compatibilityRelation.findMany({
    where: { isActive: true, status: 'VERIFIED', source: { in: ['EXPLICIT', 'MANUFACTURER'] } },
    select: { productId: true },
    distinct: ['productId'],
  });
  const ids = verified.map((v) => v.productId);
  return db.product.findMany({
    where: { status: 'ACTIVE', id: { notIn: ids } },
    select: { id: true, slug: true, name: true, category: { select: { name: true } } },
    orderBy: { popularity: 'desc' },
    take: limit,
  });
}

/** Автоматические кандидаты: правиловые связи с высокой уверенностью, ещё не подтверждённые явно. */
export async function listAutoCandidates(db: DbClient, opts: { minConfidence?: number; limit?: number } = {}) {
  return db.compatibilityRelation.findMany({
    where: { isActive: true, source: 'RULE', status: { in: ['COMPATIBLE', 'COMPATIBLE_WITH_LIMITATIONS'] }, confidence: { gte: opts.minConfidence ?? 0.85 } },
    include: { product: { select: { name: true, slug: true } }, deviceModel: { select: { name: true, slug: true } } },
    orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
    take: opts.limit ?? 100,
  });
}
