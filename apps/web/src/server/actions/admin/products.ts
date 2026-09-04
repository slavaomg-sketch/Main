'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, type Prisma } from '@techmatch/database';
import { buildProductSearchText, invalidateCompatibilityCache, setFieldOwner, setStock, slugify, storeImage, writeAudit } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { toActionError, type ActionResult } from '@/lib/errors';

const productSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z.string().trim().max(200).optional(),
  brandId: z.string().optional(),
  categoryId: z.string().min(1, 'Выберите категорию'),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
  shortDescription: z.string().max(500).optional(),
  description: z.string().max(10000).optional(),
  badges: z.string().optional(),
  packageContents: z.string().optional(),
  warrantyMonths: z.coerce.number().int().min(0).max(120).default(12),
  isFeatured: z.string().optional(),
  isNew: z.string().optional(),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(400).optional(),
  weightGrams: z.coerce.number().int().min(0).optional(),
});

const lines = (s: string | undefined) => (s ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

export async function saveProductAction(id: string | null, _prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin('products.write');
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  const d = parsed.data;
  try {
    const [brand, category] = await Promise.all([d.brandId ? prisma.productBrand.findUnique({ where: { id: d.brandId } }) : null, prisma.accessoryCategory.findUniqueOrThrow({ where: { id: d.categoryId } })]);
    const before = id ? await prisma.product.findUnique({ where: { id } }) : null;
    let slug = d.slug?.trim() ? slugify(d.slug) : before?.slug ?? slugify(`${brand?.name ?? ''} ${d.name}`);
    const clash = await prisma.product.findFirst({ where: { slug, ...(id ? { id: { not: id } } : {}) } });
    if (clash) slug = `${slug}-${Date.now().toString(36)}`;
    const data = {
      name: d.name, slug, brandId: brand?.id ?? null, categoryId: category.id, status: d.status, shortDescription: d.shortDescription || null, description: d.description || null,
      badges: lines(d.badges), packageContents: lines(d.packageContents), warrantyMonths: d.warrantyMonths, isFeatured: d.isFeatured === 'on', isNew: d.isNew === 'on',
      seoTitle: d.seoTitle || null, seoDescription: d.seoDescription || null, archivedAt: d.status === 'ARCHIVED' ? new Date() : null,
    };
    const product = id
      ? await prisma.product.update({ where: { id }, data })
      : await prisma.product.create({ data: { ...data, variants: { create: { sku: `TM-${slug.toUpperCase().slice(0, 40)}-${Date.now().toString(36).toUpperCase()}`, name: d.name, isDefault: true } } } });
    const variants = await prisma.productVariant.findMany({ where: { productId: product.id }, select: { sku: true } });
    await prisma.product.update({ where: { id: product.id }, data: { searchText: buildProductSearchText({ name: d.name, brandName: brand?.name, categoryName: category.name, skus: variants.map((v) => v.sku), shortDescription: d.shortDescription }) } });
    if (d.weightGrams !== undefined) await prisma.productVariant.updateMany({ where: { productId: product.id }, data: { weightGrams: d.weightGrams } });
    // Ручное редактирование названия/описания фиксирует ownership = MANUAL (импорт больше не перезапишет)
    if (before && (before.name !== d.name)) await setFieldOwner(prisma, product.id, 'name', 'MANUAL');
    if (before && (before.description ?? '') !== (d.description ?? '')) await setFieldOwner(prisma, product.id, 'description', 'MANUAL');
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: id ? 'product.update' : 'product.create', entityType: 'Product', entityId: product.id, before: before ? { name: before.name, status: before.status, description: before.description } : undefined, after: { name: d.name, status: d.status, categoryId: category.id } });
    invalidateCompatibilityCache();
    revalidatePath('/', 'layout');
    if (!id) redirect(`/admin/products/${product.id}?ok=${encodeURIComponent("Товар создан")}`);
    return { ok: true, data: { id: product.id } };
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e;
    return toActionError(e);
  }
}

const variantSchema = z.object({ variantId: z.string().optional(), sku: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(200), priceRub: z.coerce.number().min(0), compareAtRub: z.coerce.number().min(0).optional(), stock: z.coerce.number().int().min(0), optionValues: z.string().optional(), gtin: z.string().max(40).optional(), status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE') });

export async function saveVariantAction(productId: string, formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('products.write');
  const parsed = variantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные варианта' };
  const d = parsed.data;
  try {
    let optionValues: Prisma.InputJsonValue = {};
    if (d.optionValues?.trim()) {
      optionValues = Object.fromEntries(d.optionValues.split('\n').map((l) => l.split('=').map((s) => s.trim())).filter((p) => p[0] && p[1]) as Array<[string, string]>);
    }
    const existing = await prisma.productVariant.findUnique({ where: { sku: d.sku } });
    if (existing && existing.id !== d.variantId) return { ok: false, error: `SKU ${d.sku} уже используется` };
    const variant = d.variantId
      ? await prisma.productVariant.update({ where: { id: d.variantId }, data: { sku: d.sku, name: d.name, optionValues, gtin: d.gtin || null, status: d.status } })
      : await prisma.productVariant.create({ data: { productId, sku: d.sku, name: d.name, optionValues, gtin: d.gtin || null, status: d.status, isDefault: (await prisma.productVariant.count({ where: { productId } })) === 0 } });
    const amount = Math.round(d.priceRub * 100);
    const compareAt = d.compareAtRub ? Math.round(d.compareAtRub * 100) : null;
    const current = await prisma.price.findFirst({ where: { variantId: variant.id, priceList: 'retail', validTo: null }, orderBy: { validFrom: 'desc' } });
    if (!current || current.amountMinor !== amount || current.compareAtMinor !== compareAt) {
      if (current) await prisma.price.update({ where: { id: current.id }, data: { validTo: new Date() } });
      await prisma.price.create({ data: { variantId: variant.id, amountMinor: amount, compareAtMinor: compareAt } });
      await setFieldOwner(prisma, productId, 'price', 'MANUAL', variant.id);
    }
    const inv = await prisma.inventory.findFirst({ where: { variantId: variant.id } });
    if (!inv || inv.quantity !== d.stock) {
      await setStock(prisma, variant.id, d.stock);
      await setFieldOwner(prisma, productId, 'stock', 'MANUAL', variant.id);
    }
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: d.variantId ? 'variant.update' : 'variant.create', entityType: 'ProductVariant', entityId: variant.id, before: current || inv ? { priceMinor: current?.amountMinor, stock: inv?.quantity } : undefined, after: { sku: d.sku, priceMinor: amount, stock: d.stock } });
    revalidatePath('/', 'layout');
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveAttributesAction(productId: string, formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('products.write');
  try {
    const defs = await prisma.attributeDefinition.findMany();
    const before = await prisma.productAttribute.findMany({ where: { productId, variantId: null }, include: { attribute: true } });
    await prisma.productAttribute.deleteMany({ where: { productId, variantId: null } });
    const rows: Prisma.ProductAttributeCreateManyInput[] = [];
    for (const def of defs) {
      const raw = formData.get(`attr:${def.code}`);
      if (raw === null) continue;
      const s = String(raw).trim();
      if (!s) continue;
      let value: Prisma.InputJsonValue;
      try {
        value = def.type === 'JSON' || def.type === 'LIST' ? JSON.parse(s) : def.type === 'NUMBER' ? Number(s) : def.type === 'BOOLEAN' ? ['true', '1', 'да', 'yes', 'on'].includes(s.toLowerCase()) : s;
      } catch {
        return { ok: false, error: `Атрибут «${def.name}»: некорректный JSON` };
      }
      rows.push({ productId, attributeId: def.id, value, scopeKey: '' });
    }
    // Новые "видимые характеристики" в свободной форме: name=value построчно
    const specs = String(formData.get('specs') ?? '');
    for (const line of specs.split('\n')) {
      const [name, ...rest] = line.split('=');
      const val = rest.join('=').trim();
      if (!name?.trim() || !val) continue;
      const code = `spec_${slugify(name).replace(/-/g, '_')}`;
      const def = await prisma.attributeDefinition.upsert({ where: { code }, create: { code, name: name.trim(), type: 'STRING', group: 'Характеристики', isVisible: true, sortOrder: 500 }, update: {} });
      rows.push({ productId, attributeId: def.id, value: val, scopeKey: '' });
    }
    await prisma.productAttribute.createMany({ data: rows });
    await setFieldOwner(prisma, productId, 'compatibility' as never, 'MANUAL').catch(() => undefined);
    invalidateCompatibilityCache();
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'product.attributes', entityType: 'Product', entityId: productId, before: Object.fromEntries(before.map((b) => [b.attribute.code, b.value])), after: Object.fromEntries(rows.map((r) => [defs.find((d) => d.id === r.attributeId)?.code ?? r.attributeId, r.value])) });
    revalidatePath('/', 'layout');
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

export async function uploadProductImageAction(productId: string, formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('products.write');
  try {
    const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) return { ok: false, error: 'Выберите файлы' };
    const count = await prisma.productImage.count({ where: { productId } });
    for (const [i, file] of files.entries()) {
      const asset = await storeImage(prisma, { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type, source: 'UPLOAD' });
      const exists = await prisma.productImage.findFirst({ where: { productId, assetId: asset.id } });
      if (!exists) await prisma.productImage.create({ data: { productId, assetId: asset.id, sortOrder: count + i, isPrimary: count === 0 && i === 0 } });
    }
    await setFieldOwner(prisma, productId, 'images', 'MANUAL');
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'product.images.upload', entityType: 'Product', entityId: productId, after: { files: files.map((f) => f.name) } });
    revalidatePath('/', 'layout');
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeProductImageAction(productId: string, imageId: string): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('products.write');
  await prisma.productImage.deleteMany({ where: { id: imageId, productId } });
  const first = await prisma.productImage.findFirst({ where: { productId }, orderBy: { sortOrder: 'asc' } });
  if (first) await prisma.productImage.update({ where: { id: first.id }, data: { isPrimary: true } });
  await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'product.images.remove', entityType: 'Product', entityId: productId, after: { imageId } });
  revalidatePath('/', 'layout');
  return { ok: true, data: undefined };
}

export async function setOwnershipAction(productId: string, field: string, owner: 'MANUAL' | 'SOURCE'): Promise<ActionResult<undefined>> {
  await requireAdmin('products.write');
  await setFieldOwner(prisma, productId, field as 'name', owner);
  revalidatePath(`/admin/products/${productId}`);
  return { ok: true, data: undefined };
}
