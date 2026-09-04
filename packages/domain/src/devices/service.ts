import { Prisma, type DbClient } from '@techmatch/database';
import { normalizeDeviceQuery, normalizeIdentifier, tokenize } from '../shared/normalize';
import { NotFoundError } from '../shared/errors';

export interface DeviceCandidate {
  id: string;
  slug: string;
  name: string;
  fullName: string;
  brand: { name: string; slug: string };
  category: { name: string; slug: string; icon: string };
  family: { name: string; slug: string } | null;
  releaseYear: number | null;
  imageUrl: string | null;
  score: number;
  matchedBy: 'alias' | 'identifier' | 'name' | 'fuzzy';
  variants: Array<{ id: string; slug: string; name: string }>;
}

export interface DeviceSearchResult {
  query: string;
  normalized: string;
  candidates: DeviceCandidate[];
  /** exact — один уверенный кандидат; ambiguous — нужно уточнить; none — ничего не найдено */
  resolution: 'exact' | 'ambiguous' | 'none';
  best: DeviceCandidate | null;
  /** Подсказка для уточнения: чем различаются кандидаты (год, диагональ, поколение) */
  disambiguationHint: string | null;
}

const candidateSelect = {
  id: true,
  slug: true,
  name: true,
  fullName: true,
  releaseYear: true,
  imageUrl: true,
  popularity: true,
  brand: { select: { name: true, slug: true } },
  category: { select: { name: true, slug: true, icon: true } },
  family: { select: { name: true, slug: true } },
  variants: { select: { id: true, slug: true, name: true }, where: { isActive: true }, orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.DeviceModelSelect;

type Row = Prisma.DeviceModelGetPayload<{ select: typeof candidateSelect }>;

function toCandidate(row: Row, score: number, matchedBy: DeviceCandidate['matchedBy']): DeviceCandidate {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    fullName: row.fullName,
    brand: row.brand,
    category: row.category,
    family: row.family,
    releaseYear: row.releaseYear,
    imageUrl: row.imageUrl,
    score,
    matchedBy,
    variants: row.variants,
  };
}

/**
 * Поиск устройства по свободному запросу: точные алиасы → номера моделей → триграммное сходство.
 * Без LLM: детерминированный алгоритм, результат воспроизводим.
 */
export async function searchDevices(db: DbClient, rawQuery: string, opts: { limit?: number; log?: boolean; sessionKey?: string } = {}): Promise<DeviceSearchResult> {
  const limit = opts.limit ?? 8;
  const normalized = normalizeDeviceQuery(rawQuery);
  const empty: DeviceSearchResult = { query: rawQuery, normalized, candidates: [], resolution: 'none', best: null, disambiguationHint: null };
  if (normalized.length < 2) return empty;

  const scores = new Map<string, { score: number; matchedBy: DeviceCandidate['matchedBy'] }>();
  const bump = (id: string, score: number, matchedBy: DeviceCandidate['matchedBy']) => {
    const prev = scores.get(id);
    if (!prev || prev.score < score) scores.set(id, { score, matchedBy });
  };

  // 1. Точное совпадение алиаса или префикс
  const aliasRows = await db.$queryRaw<Array<{ deviceModelId: string; normalized: string; weight: number; sim: number }>>`
    SELECT "deviceModelId", "normalized", "weight", similarity("normalized", ${normalized}) AS sim
    FROM "DeviceAlias"
    WHERE "normalized" = ${normalized}
       OR "normalized" LIKE ${normalized + '%'}
       OR ${normalized} LIKE "normalized" || '%'
       OR similarity("normalized", ${normalized}) > 0.45
    ORDER BY sim DESC
    LIMIT 60`;
  const qTokens = tokenize(normalized);
  for (const a of aliasRows) {
    if (a.normalized === normalized) bump(a.deviceModelId, 1.0, 'alias');
    else if (a.normalized.startsWith(normalized) || normalized.startsWith(a.normalized)) {
      // Префикс: "iphone 15" совпадает с "iphone 15", "iphone 15 pro", "iphone 15 pro max"
      const aTokens = tokenize(a.normalized);
      const extra = Math.abs(aTokens.length - qTokens.length);
      bump(a.deviceModelId, Math.max(0.55, 0.92 - extra * 0.12), 'alias');
    } else bump(a.deviceModelId, Math.min(0.85, a.sim), 'fuzzy');
  }

  // 2. Идентификаторы (номер модели A2848, MQ9E3 и т.п.)
  const ident = normalizeIdentifier(rawQuery);
  if (ident.length >= 4) {
    const idRows = await db.deviceIdentifier.findMany({ where: { OR: [{ normalized: ident }, { normalized: { startsWith: ident } }] }, select: { deviceModelId: true, normalized: true }, take: 20 });
    for (const r of idRows) bump(r.deviceModelId, r.normalized === ident ? 1.0 : 0.8, 'identifier');
  }

  // 3. Полное имя: сходство по триграммам
  const nameRows = await db.$queryRaw<Array<{ id: string; sim: number }>>`
    SELECT id, similarity(lower("fullName"), ${normalized}) AS sim
    FROM "DeviceModel"
    WHERE "isActive" = true AND similarity(lower("fullName"), ${normalized}) > 0.25
    ORDER BY sim DESC LIMIT 20`;
  for (const r of nameRows) bump(r.id, Math.min(0.8, r.sim + 0.1), 'name');

  // 4. Все токены запроса встречаются в алиасах устройства (порядок не важен)
  if (qTokens.length >= 2) {
    const tokenRows = await db.$queryRaw<Array<{ deviceModelId: string }>>`
      SELECT DISTINCT "deviceModelId" FROM "DeviceAlias"
      WHERE ${Prisma_and(qTokens)}
      LIMIT 30`;
    for (const r of tokenRows) bump(r.deviceModelId, 0.75, 'alias');
  }

  if (scores.size === 0) {
    if (opts.log) await logSearch(db, rawQuery, normalized, 0, null, opts.sessionKey);
    return empty;
  }
  const ids = Array.from(scores.keys());
  const rows = await db.deviceModel.findMany({ where: { id: { in: ids }, isActive: true }, select: candidateSelect });
  const candidates = rows
    .map((r) => {
      const s = scores.get(r.id)!;
      return toCandidate(r, s.score + Math.min(0.05, r.popularity / 10000), s.matchedBy);
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const best = candidates[0] ?? null;
  const second = candidates[1] ?? null;
  let resolution: DeviceSearchResult['resolution'] = 'none';
  let hint: string | null = null;
  if (best) {
    const exactAlias = best.matchedBy === 'alias' && best.score >= 1.0;
    const clearLead = !second || best.score - second.score >= 0.15;
    if ((exactAlias || best.matchedBy === 'identifier') && clearLead) resolution = 'exact';
    else if (exactAlias && second && second.score >= 1.0) resolution = 'ambiguous';
    else if (best.score >= 0.9 && clearLead) resolution = 'exact';
    else if (!second && best.score >= 0.8) resolution = 'exact';
    else resolution = 'ambiguous';
    if (resolution === 'ambiguous') hint = buildHint(candidates);
    // Один кандидат с несколькими вариантами (MacBook Air 13/15) — тоже просим уточнить
    if (resolution === 'exact' && best.variants.length > 1 && best.score < 1.0) {
      resolution = 'ambiguous';
      hint = `Уточните модификацию: ${best.variants.map((v) => v.name).join(', ')}`;
    }
  }
  if (opts.log) await logSearch(db, rawQuery, normalized, candidates.length, resolution === 'exact' ? best?.id ?? null : null, opts.sessionKey);
  return { query: rawQuery, normalized, candidates, resolution, best, disambiguationHint: hint };
}

// Собирает `"normalized" LIKE '%tok1%' AND "normalized" LIKE '%tok2%'` безопасно
function Prisma_and(tokens: string[]) {
  return Prisma.join(
    tokens.map((t) => Prisma.sql`"normalized" LIKE ${'%' + t + '%'}`),
    ' AND ',
  );
}

function buildHint(c: DeviceCandidate[]): string {
  const families = new Set(c.map((x) => x.family?.name ?? x.name));
  const years = new Set(c.map((x) => x.releaseYear).filter(Boolean));
  if (families.size === 1 && years.size > 1) return 'Похожие модели разных лет — уточните год или поколение';
  if (families.size === 1) return 'В этой линейке несколько моделей — выберите точную';
  return 'Найдено несколько подходящих устройств — выберите своё';
}

async function logSearch(db: DbClient, query: string, normalized: string, resultCount: number, matchedDeviceModelId: string | null, sessionKey?: string) {
  try {
    await db.searchQueryLog.create({ data: { query: query.slice(0, 200), normalized: normalized.slice(0, 200), scope: 'DEVICE', resultCount, matchedDeviceModelId, sessionKey: sessionKey ?? null } });
  } catch {
    // лог не должен ломать поиск
  }
}

export async function getDeviceBySlug(db: DbClient, slug: string) {
  const device = await db.deviceModel.findUnique({
    where: { slug },
    include: {
      brand: true,
      category: true,
      family: true,
      variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      specifications: true,
      identifiers: true,
      aliases: { orderBy: { weight: 'desc' }, take: 8 },
    },
  });
  if (!device || !device.isActive) throw new NotFoundError('Устройство', slug);
  return device;
}

export async function listDeviceCategories(db: DbClient) {
  return db.deviceCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, include: { _count: { select: { models: true } } } });
}

export async function listDevicesByCategory(db: DbClient, categorySlug: string) {
  const category = await db.deviceCategory.findUnique({ where: { slug: categorySlug } });
  if (!category) throw new NotFoundError('Категория устройств', categorySlug);
  const models = await db.deviceModel.findMany({
    where: { categoryId: category.id, isActive: true },
    select: candidateSelect,
    orderBy: [{ popularity: 'desc' }, { name: 'asc' }],
  });
  return { category, models: models.map((m) => toCandidate(m, 0, 'name')) };
}

export async function listPopularDevices(db: DbClient, limit = 12) {
  const rows = await db.deviceModel.findMany({ where: { isActive: true }, select: candidateSelect, orderBy: { popularity: 'desc' }, take: limit });
  return rows.map((m) => toCandidate(m, 0, 'name'));
}

export async function listDeviceBrands(db: DbClient) {
  return db.deviceBrand.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, include: { _count: { select: { models: true } } } });
}

/** Статистика неудачных запросов для дашборда. */
export async function failedDeviceSearches(db: DbClient, limit = 20) {
  return db.searchQueryLog.groupBy({
    by: ['normalized'],
    where: { scope: 'DEVICE', resultCount: 0 },
    _count: { normalized: true },
    _max: { createdAt: true },
    orderBy: { _count: { normalized: 'desc' } },
    take: limit,
  });
}

export async function popularQueries(db: DbClient, limit = 10) {
  return db.searchQueryLog.groupBy({
    by: ['normalized'],
    where: { scope: 'DEVICE', resultCount: { gt: 0 } },
    _count: { normalized: true },
    orderBy: { _count: { normalized: 'desc' } },
    take: limit,
  });
}
