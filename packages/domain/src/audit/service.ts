import type { DbClient, Prisma } from '@techmatch/database';

export interface AuditInput {
  actorType: 'SYSTEM' | 'ADMIN' | 'CUSTOMER';
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

const SENSITIVE = /password|secret|token|hash|key/i;

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE.test(k) ? '[скрыто]' : scrub(v);
    return out;
  }
  return value;
}

export async function writeAudit(db: DbClient, input: AuditInput) {
  try {
    await db.auditLog.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        before: input.before === undefined ? undefined : (scrub(input.before) as Prisma.InputJsonValue),
        after: input.after === undefined ? undefined : (scrub(input.after) as Prisma.InputJsonValue),
        ip: input.ip ?? null,
      },
    });
  } catch (e) {
    console.warn('[audit] запись не сохранена', e);
  }
}

export async function listAudit(db: DbClient, opts: { entityType?: string | null; action?: string | null; actorId?: string | null; page?: number; perPage?: number }) {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(200, opts.perPage ?? 50);
  const where: Prisma.AuditLogWhereInput = {};
  if (opts.entityType) where.entityType = opts.entityType;
  if (opts.action) where.action = { contains: opts.action };
  if (opts.actorId) where.actorId = opts.actorId;
  const [items, total] = await Promise.all([db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }), db.auditLog.count({ where })]);
  return { items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
}
