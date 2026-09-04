'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, type Prisma } from '@techmatch/database';
import { invalidateCompatibilityCache, normalizeDeviceQuery, normalizeIdentifier, slugify, writeAudit } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { toActionError, type ActionResult } from '@/lib/errors';

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  fullName: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(200).optional(),
  brandId: z.string().min(1, 'Выберите бренд'),
  categoryId: z.string().min(1, 'Выберите категорию'),
  familyName: z.string().trim().max(120).optional(),
  generation: z.string().trim().max(60).optional(),
  releaseYear: z.coerce.number().int().min(1990).max(2100).optional().or(z.literal('')),
  primaryModelNumber: z.string().trim().max(60).optional(),
  description: z.string().max(4000).optional(),
  popularity: z.coerce.number().int().min(0).default(0),
  isActive: z.string().optional(),
  specsAreDemo: z.string().optional(),
  specs: z.string().optional(),
  aliases: z.string().optional(),
  identifiers: z.string().optional(),
  variants: z.string().optional(),
});

export async function saveDeviceAction(id: string | null, _prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin('devices.write');
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  const d = parsed.data;
  let specs: Record<string, unknown> = {};
  if (d.specs?.trim()) {
    try {
      specs = JSON.parse(d.specs) as Record<string, unknown>;
      if (typeof specs !== 'object' || Array.isArray(specs)) throw new Error();
    } catch {
      return { ok: false, error: 'Характеристики: ожидается JSON-объект, например {"ports":[{"type":"USB_C"}],"charging":{...}}' };
    }
  }
  try {
    const [brand, category] = await Promise.all([prisma.deviceBrand.findUniqueOrThrow({ where: { id: d.brandId } }), prisma.deviceCategory.findUniqueOrThrow({ where: { id: d.categoryId } })]);
    const before = id ? await prisma.deviceModel.findUnique({ where: { id }, include: { specifications: true } }) : null;
    let slug = d.slug?.trim() ? slugify(d.slug) : before?.slug ?? slugify(`${brand.name} ${d.name}`);
    const clash = await prisma.deviceModel.findFirst({ where: { slug, ...(id ? { id: { not: id } } : {}) } });
    if (clash) slug = `${slug}-${Date.now().toString(36)}`;
    const family = d.familyName?.trim()
      ? await prisma.deviceFamily.upsert({ where: { slug: slugify(`${brand.name} ${d.familyName}`) }, create: { slug: slugify(`${brand.name} ${d.familyName}`), name: d.familyName.trim(), brandId: brand.id, categoryId: category.id }, update: {} })
      : null;
    const data = { name: d.name, fullName: d.fullName, slug, brandId: brand.id, categoryId: category.id, familyId: family?.id ?? null, generation: d.generation || null, releaseYear: d.releaseYear ? Number(d.releaseYear) : null, primaryModelNumber: d.primaryModelNumber || null, description: d.description || null, popularity: d.popularity, isActive: d.isActive === 'on', specsAreDemo: d.specsAreDemo === 'on' };
    const model = id ? await prisma.deviceModel.update({ where: { id }, data }) : await prisma.deviceModel.create({ data });
    // Характеристики модели (варианты не трогаем)
    if (d.specs !== undefined) {
      await prisma.deviceSpecification.deleteMany({ where: { deviceModelId: model.id, variantId: null } });
      await prisma.deviceSpecification.createMany({ data: Object.entries(specs).map(([key, value]) => ({ deviceModelId: model.id, key, value: value as Prisma.InputJsonValue, source: 'ADMIN', isDemo: d.specsAreDemo === 'on', verifiedAt: d.specsAreDemo === 'on' ? null : new Date() })) });
    }
    // Алиасы
    if (d.aliases !== undefined) {
      await prisma.deviceAlias.deleteMany({ where: { deviceModelId: model.id, variantId: null } });
      const set = new Map<string, string>();
      for (const a of [d.name, d.fullName, `${brand.name} ${d.name}`, ...(d.aliases ?? '').split('\n')]) {
        const n = normalizeDeviceQuery(a.trim());
        if (a.trim() && n.length >= 2 && !set.has(n)) set.set(n, a.trim());
      }
      await prisma.deviceAlias.createMany({ data: Array.from(set, ([normalized, alias]) => ({ deviceModelId: model.id, alias, normalized, kind: /[а-я]/i.test(alias) ? 'TRANSLIT' : 'SYNONYM', weight: 2 })), skipDuplicates: true });
    }
    // Идентификаторы: "A2681", "A2681 | US", "MODEL_NUMBER:A2681 | US"
    if (d.identifiers !== undefined) {
      await prisma.deviceIdentifier.deleteMany({ where: { deviceModelId: model.id, variantId: null } });
      const rows = (d.identifiers ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const [left, region] = l.split('|').map((s) => s.trim());
        const [maybeType, ...rest] = (left ?? '').split(':');
        const hasType = rest.length > 0 && ['MODEL_NUMBER', 'PART_NUMBER', 'EAN', 'MARKETING_CODE', 'ORDER_CODE'].includes(maybeType ?? '');
        const value = hasType ? rest.join(':').trim() : (left ?? '').trim();
        return { deviceModelId: model.id, type: (hasType ? maybeType : 'MODEL_NUMBER') as 'MODEL_NUMBER', value, normalized: normalizeIdentifier(value), region: region || null };
      }).filter((r) => r.value);
      await prisma.deviceIdentifier.createMany({ data: rows, skipDuplicates: true });
    }
    // Варианты: "slug | Название | {json specs}"
    if (d.variants !== undefined) {
      const lines = (d.variants ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
      const keep: string[] = [];
      for (const [i, line] of lines.entries()) {
        const [vslug, vname, vspecs] = line.split('|').map((s) => s.trim());
        if (!vslug || !vname) continue;
        const v = await prisma.deviceVariant.upsert({ where: { deviceModelId_slug: { deviceModelId: model.id, slug: slugify(vslug) } }, create: { deviceModelId: model.id, slug: slugify(vslug), name: vname, sortOrder: i }, update: { name: vname, sortOrder: i, isActive: true } });
        keep.push(v.id);
        if (vspecs) {
          try {
            const obj = JSON.parse(vspecs) as Record<string, unknown>;
            await prisma.deviceSpecification.deleteMany({ where: { variantId: v.id } });
            await prisma.deviceSpecification.createMany({ data: Object.entries(obj).map(([key, value]) => ({ deviceModelId: model.id, variantId: v.id, key, value: value as Prisma.InputJsonValue, source: 'ADMIN' })) });
          } catch {
            return { ok: false, error: `Вариант «${vname}»: некорректный JSON характеристик` };
          }
        }
      }
      await prisma.deviceVariant.updateMany({ where: { deviceModelId: model.id, id: { notIn: keep } }, data: { isActive: false } });
    }
    invalidateCompatibilityCache();
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: id ? 'device.update' : 'device.create', entityType: 'DeviceModel', entityId: model.id, before: before ? { name: before.name, fullName: before.fullName, specs: Object.fromEntries(before.specifications.filter((s) => !s.variantId).map((s) => [s.key, s.value])) } : undefined, after: { name: d.name, fullName: d.fullName, specs } });
    revalidatePath('/', 'layout');
    if (!id) redirect(`/admin/devices/${model.id}?ok=${encodeURIComponent("Устройство создано")}`);
    return { ok: true, data: { id: model.id } };
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e;
    return toActionError(e);
  }
}

export async function uploadDeviceImageAction(id: string, formData: FormData): Promise<ActionResult<undefined>> {
  await requireAdmin('devices.write');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Выберите файл' };
  try {
    const { storeImage } = await import('@techmatch/domain');
    const asset = await storeImage(prisma, { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type, source: 'UPLOAD' });
    await prisma.deviceModel.update({ where: { id }, data: { imageAssetId: asset.id, imageUrl: (asset.variants as Record<string, string>).card ?? asset.publicUrl } });
    revalidatePath('/', 'layout');
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}
