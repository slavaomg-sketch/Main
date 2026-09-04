'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@techmatch/database';
import { slugify, storeImage, writeAudit } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { runAction, type ActionResult } from '@/lib/errors';

const couponSchema = z.object({ id: z.string().optional(), code: z.string().trim().min(3).max(30), discountType: z.enum(['PERCENT', 'FIXED']), value: z.coerce.number().min(0), minSubtotalRub: z.coerce.number().min(0).default(0), maxDiscountRub: z.coerce.number().min(0).optional().or(z.literal('')), usageLimit: z.coerce.number().int().min(0).optional().or(z.literal('')), perCustomerLimit: z.coerce.number().int().min(0).optional().or(z.literal('')), startsAt: z.string().optional(), endsAt: z.string().optional(), isActive: z.string().optional(), promotionId: z.string().optional() });

export async function saveCouponAction(formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('promotions.write');
  const parsed = couponSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  const d = parsed.data;
  return runAction(async () => {
    const code = d.code.toUpperCase();
    const data = { code, discountType: d.discountType, value: d.discountType === 'PERCENT' ? Math.round(d.value) : Math.round(d.value * 100), minSubtotalMinor: Math.round(d.minSubtotalRub * 100), maxDiscountMinor: d.maxDiscountRub ? Math.round(Number(d.maxDiscountRub) * 100) : null, usageLimit: d.usageLimit ? Number(d.usageLimit) : null, perCustomerLimit: d.perCustomerLimit ? Number(d.perCustomerLimit) : null, startsAt: d.startsAt ? new Date(d.startsAt) : null, endsAt: d.endsAt ? new Date(d.endsAt) : null, isActive: d.isActive === 'on', promotionId: d.promotionId || null };
    if (data.discountType === 'PERCENT' && (data.value < 1 || data.value > 100)) throw new Error('Процент скидки от 1 до 100');
    const c = d.id ? await prisma.coupon.update({ where: { id: d.id }, data }) : await prisma.coupon.create({ data });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: d.id ? 'coupon.update' : 'coupon.create', entityType: 'Coupon', entityId: c.id, after: data });
    revalidatePath('/admin/promotions');
    return undefined;
  });
}

const promoSchema = z.object({ id: z.string().optional(), name: z.string().trim().min(2).max(120), slug: z.string().max(120).optional(), description: z.string().max(500).optional(), discountType: z.enum(['PERCENT', 'FIXED']), value: z.coerce.number().min(0), scope: z.enum(['ALL', 'CATEGORY', 'PRODUCT', 'BRAND', 'BUNDLE']), categoryId: z.string().optional(), brandId: z.string().optional(), badgeLabel: z.string().max(30).optional(), startsAt: z.string().optional(), endsAt: z.string().optional(), isActive: z.string().optional() });

export async function savePromotionAction(formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('promotions.write');
  const parsed = promoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  const d = parsed.data;
  return runAction(async () => {
    const slug = slugify(d.slug || d.name);
    const data = { name: d.name, slug, description: d.description || null, discountType: d.discountType, value: d.discountType === 'PERCENT' ? Math.round(d.value) : Math.round(d.value * 100), scope: d.scope, categoryId: d.scope === 'CATEGORY' ? d.categoryId || null : null, brandId: d.scope === 'BRAND' ? d.brandId || null : null, badgeLabel: d.badgeLabel || null, startsAt: d.startsAt ? new Date(d.startsAt) : null, endsAt: d.endsAt ? new Date(d.endsAt) : null, isActive: d.isActive === 'on' };
    const p = d.id ? await prisma.promotion.update({ where: { id: d.id }, data }) : await prisma.promotion.create({ data });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: d.id ? 'promotion.update' : 'promotion.create', entityType: 'Promotion', entityId: p.id, after: data });
    revalidatePath('/admin/promotions');
    return undefined;
  });
}

const bundleSchema = z.object({ id: z.string().optional(), name: z.string().trim().min(2).max(120), slug: z.string().max(120).optional(), description: z.string().max(500).optional(), discountPercent: z.coerce.number().int().min(0).max(90).default(0), items: z.string(), devices: z.string().optional(), isActive: z.string().optional(), sortOrder: z.coerce.number().int().default(0) });

export async function saveBundleAction(formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('promotions.write');
  const parsed = bundleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  const d = parsed.data;
  return runAction(async () => {
    const slug = slugify(d.slug || d.name);
    const lines = d.items.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [sku, qty] = l.split(/\s*[x×*]\s*/); return { sku: sku!.trim(), quantity: Math.max(1, Number(qty ?? 1) || 1) }; });
    const variants = await prisma.productVariant.findMany({ where: { sku: { in: lines.map((l) => l.sku) } } });
    if (variants.length !== lines.length) throw new Error(`Не найдены SKU: ${lines.filter((l) => !variants.some((v) => v.sku === l.sku)).map((l) => l.sku).join(', ')}`);
    let imageAssetId: string | undefined;
    const file = formData.get('image');
    if (file instanceof File && file.size > 0) imageAssetId = (await storeImage(prisma, { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type, source: 'UPLOAD' })).id;
    const data = { name: d.name, slug, description: d.description || null, discountPercent: d.discountPercent, isActive: d.isActive === 'on', sortOrder: d.sortOrder, ...(imageAssetId ? { imageAssetId } : {}) };
    const bundle = d.id ? await prisma.bundle.update({ where: { id: d.id }, data }) : await prisma.bundle.create({ data });
    await prisma.bundleItem.deleteMany({ where: { bundleId: bundle.id } });
    await prisma.bundleItem.createMany({ data: lines.map((l, i) => ({ bundleId: bundle.id, variantId: variants.find((v) => v.sku === l.sku)!.id, quantity: l.quantity, sortOrder: i })) });
    const deviceSlugs = (d.devices ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    const devices = await prisma.deviceModel.findMany({ where: { slug: { in: deviceSlugs } }, select: { id: true } });
    await prisma.bundleDevice.deleteMany({ where: { bundleId: bundle.id } });
    await prisma.bundleDevice.createMany({ data: devices.map((dv) => ({ bundleId: bundle.id, deviceModelId: dv.id })) });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: d.id ? 'bundle.update' : 'bundle.create', entityType: 'Bundle', entityId: bundle.id, after: { ...data, items: lines, devices: deviceSlugs } });
    revalidatePath('/', 'layout');
    return undefined;
  });
}
