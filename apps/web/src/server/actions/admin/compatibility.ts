'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@techmatch/database';
import { checkCompatibility, deactivateRelation, removeCompatibilityOverride, setCompatibilityOverride, upsertExplicitRelation, writeAudit, type CompatibilityResult } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { runAction, type ActionResult } from '@/lib/errors';

const relSchema = z.object({
  productId: z.string().min(1, 'Выберите товар'),
  deviceModelId: z.string().min(1, 'Выберите устройство'),
  status: z.enum(['VERIFIED', 'COMPATIBLE', 'COMPATIBLE_WITH_LIMITATIONS', 'INCOMPATIBLE']),
  source: z.enum(['EXPLICIT', 'MANUFACTURER']).default('EXPLICIT'),
  reasons: z.string().optional(),
  limitations: z.string().optional(),
  evidenceType: z.enum(['', 'MANUFACTURER_DOC', 'ADMIN_CONFIRMED', 'LAB_TEST', 'CUSTOMER_REPORT']).optional(),
  evidenceUrl: z.string().max(500).optional(),
  evidenceNote: z.string().max(500).optional(),
});

const lines = (s?: string) => (s ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

export async function saveRelationAction(formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('compatibility.write');
  const parsed = relSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  const d = parsed.data;
  return runAction(async () => {
    const rel = await upsertExplicitRelation(prisma, { productId: d.productId, deviceModelId: d.deviceModelId, status: d.status, source: d.source, reasons: lines(d.reasons), limitations: lines(d.limitations), adminId: admin.id, evidence: d.evidenceType ? [{ type: d.evidenceType, url: d.evidenceUrl || undefined, note: d.evidenceNote || undefined }] : [] });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'compatibility.relation.upsert', entityType: 'CompatibilityRelation', entityId: rel.id, after: { productId: d.productId, deviceModelId: d.deviceModelId, status: d.status, source: d.source } });
    revalidatePath('/admin/compatibility');
    return undefined;
  });
}

export async function deactivateRelationAction(id: string): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('compatibility.write');
  return runAction(async () => {
    const before = await prisma.compatibilityRelation.findUnique({ where: { id } });
    await deactivateRelation(prisma, id);
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'compatibility.relation.deactivate', entityType: 'CompatibilityRelation', entityId: id, before: before ? { status: before.status, source: before.source } : undefined });
    revalidatePath('/admin/compatibility');
    return undefined;
  });
}

/** Подтверждение автоматического кандидата: правиловая связь → явная VERIFIED. */
export async function confirmCandidateAction(relationId: string): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('compatibility.write');
  return runAction(async () => {
    const rel = await prisma.compatibilityRelation.findUniqueOrThrow({ where: { id: relationId } });
    await upsertExplicitRelation(prisma, { productId: rel.productId, deviceModelId: rel.deviceModelId, deviceVariantId: rel.deviceVariantId, status: 'VERIFIED', source: 'EXPLICIT', reasons: rel.reasons as string[], limitations: rel.limitations as string[], adminId: admin.id, evidence: [{ type: 'ADMIN_CONFIRMED', note: `Подтверждён автоматический кандидат (правила: ${rel.rulesApplied.join(', ')})` }] });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'compatibility.candidate.confirm', entityType: 'CompatibilityRelation', entityId: relationId, after: { productId: rel.productId, deviceModelId: rel.deviceModelId } });
    revalidatePath('/admin/compatibility');
    return undefined;
  });
}

const overrideSchema = z.object({ productId: z.string().min(1), deviceModelId: z.string().min(1), status: z.enum(['VERIFIED', 'COMPATIBLE_WITH_LIMITATIONS', 'INCOMPATIBLE']), reason: z.string().trim().min(3, 'Укажите причину').max(500) });

export async function saveOverrideAction(formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('compatibility.write');
  const parsed = overrideSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  return runAction(async () => {
    const ov = await setCompatibilityOverride(prisma, { ...parsed.data, adminId: admin.id });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'compatibility.override.set', entityType: 'CompatibilityOverride', entityId: ov.id, after: parsed.data });
    revalidatePath('/admin/compatibility');
    return undefined;
  });
}

export async function removeOverrideAction(id: string): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('compatibility.write');
  return runAction(async () => {
    await removeCompatibilityOverride(prisma, id);
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'compatibility.override.remove', entityType: 'CompatibilityOverride', entityId: id });
    revalidatePath('/admin/compatibility');
    return undefined;
  });
}

export async function checkPairAction(productId: string, deviceModelId: string): Promise<ActionResult<CompatibilityResult>> {
  await requireAdmin('compatibility.read');
  return runAction(() => checkCompatibility(prisma, { productId, deviceModelId, log: false }));
}
