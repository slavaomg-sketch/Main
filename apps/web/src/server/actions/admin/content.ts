'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, type Prisma } from '@techmatch/database';
import { DEFAULT_HOMEPAGE, getHomepageSettings, setSetting, slugify, storeImage, writeAudit, type HomepageSettings } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { runAction, type ActionResult } from '@/lib/errors';

const lines = (s: FormDataEntryValue | null) => String(s ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
const triples = (s: FormDataEntryValue | null) => lines(s).map((l) => l.split('|').map((x) => x.trim())).filter((p) => p.length >= 3).map(([icon, title, text]) => ({ icon: icon!, title: title!, text: text! }));

export async function saveHomepageAction(formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('content.write');
  return runAction(async () => {
    const before = await getHomepageSettings(prisma);
    const next: HomepageSettings = {
      ...DEFAULT_HOMEPAGE,
      heroEyebrow: String(formData.get('heroEyebrow') ?? ''),
      heroTitle: String(formData.get('heroTitle') ?? ''),
      heroSubtitle: String(formData.get('heroSubtitle') ?? ''),
      heroSearchPlaceholder: String(formData.get('heroSearchPlaceholder') ?? ''),
      heroNote: String(formData.get('heroNote') ?? ''),
      popularQueries: lines(formData.get('popularQueries')),
      advantages: triples(formData.get('advantages')),
      headerBenefits: triples(formData.get('headerBenefits')),
      newsletterTitle: String(formData.get('newsletterTitle') ?? ''),
      newsletterText: String(formData.get('newsletterText') ?? ''),
      trustTitle: String(formData.get('trustTitle') ?? ''),
      trustText: String(formData.get('trustText') ?? ''),
      featuredCollectionSlug: String(formData.get('featuredCollectionSlug') ?? 'popular'),
      bundlesLimit: Number(formData.get('bundlesLimit') ?? 3) || 3,
    };
    await setSetting(prisma, 'homepage', next);
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'content.homepage', entityType: 'SiteSetting', entityId: 'homepage', before, after: next });
    revalidatePath('/', 'layout');
    return undefined;
  });
}

const bannerSchema = z.object({ id: z.string().optional(), placement: z.enum(['HOME_HERO', 'HOME_PROMO', 'HOME_WIDE', 'CATALOG_TOP', 'DEVICE_PAGE']), theme: z.enum(['LIGHT', 'DARK', 'BLUE', 'GREEN', 'ORANGE', 'MINT']), title: z.string().trim().min(1).max(120), subtitle: z.string().max(300).optional(), ctaLabel: z.string().max(60).optional(), ctaUrl: z.string().max(300).optional(), handwrittenNote: z.string().max(80).optional(), sortOrder: z.coerce.number().int().default(0), isActive: z.string().optional() });

export async function saveBannerAction(formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('content.write');
  const parsed = bannerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  const d = parsed.data;
  return runAction(async () => {
    let imageAssetId: string | undefined;
    const file = formData.get('image');
    if (file instanceof File && file.size > 0) imageAssetId = (await storeImage(prisma, { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type, source: 'UPLOAD' })).id;
    const data = { placement: d.placement, theme: d.theme, title: d.title, subtitle: d.subtitle || null, ctaLabel: d.ctaLabel || null, ctaUrl: d.ctaUrl || null, handwrittenNote: d.handwrittenNote || null, sortOrder: d.sortOrder, isActive: d.isActive === 'on', ...(imageAssetId ? { imageAssetId } : {}) };
    const before = d.id ? await prisma.banner.findUnique({ where: { id: d.id } }) : null;
    const banner = d.id ? await prisma.banner.update({ where: { id: d.id }, data }) : await prisma.banner.create({ data });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: d.id ? 'content.banner.update' : 'content.banner.create', entityType: 'Banner', entityId: banner.id, before: before ? { title: before.title, isActive: before.isActive } : undefined, after: data });
    revalidatePath('/', 'layout');
    return undefined;
  });
}

export async function deleteBannerAction(id: string): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('content.write');
  return runAction(async () => {
    const b = await prisma.banner.delete({ where: { id } });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'content.banner.delete', entityType: 'Banner', entityId: id, before: { title: b.title } });
    revalidatePath('/', 'layout');
    return undefined;
  });
}

export async function saveCollectionAction(formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('content.write');
  return runAction(async () => {
    const slug = slugify(String(formData.get('slug') ?? ''));
    const name = String(formData.get('name') ?? '').trim();
    if (!slug || !name) throw new Error('Укажите slug и название');
    const skus = lines(formData.get('products'));
    const col = await prisma.collection.upsert({ where: { slug }, create: { slug, name, type: 'MANUAL', isActive: formData.get('isActive') === 'on' }, update: { name, isActive: formData.get('isActive') === 'on' } });
    const products = await prisma.product.findMany({ where: { OR: [{ slug: { in: skus } }, { variants: { some: { sku: { in: skus } } } }] }, select: { id: true, slug: true, variants: { select: { sku: true } } } });
    await prisma.collectionItem.deleteMany({ where: { collectionId: col.id } });
    const ordered = skus.map((s) => products.find((p) => p.slug === s || p.variants.some((v) => v.sku === s))?.id).filter((x): x is string => Boolean(x));
    await prisma.collectionItem.createMany({ data: Array.from(new Set(ordered)).map((productId, i) => ({ collectionId: col.id, productId, sortOrder: i })) });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'content.collection.save', entityType: 'Collection', entityId: col.id, after: { name, products: ordered.length } });
    revalidatePath('/', 'layout');
    return undefined;
  });
}

const pageSchema = z.object({ slug: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(160), body: z.string().max(50000), seoTitle: z.string().max(200).optional(), seoDescription: z.string().max(400).optional(), isPublished: z.string().optional(), sortOrder: z.coerce.number().int().default(0) });

export async function savePageAction(formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('content.write');
  const parsed = pageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  const d = parsed.data;
  return runAction(async () => {
    const slug = slugify(d.slug);
    const before = await prisma.contentPage.findUnique({ where: { slug } });
    const data = { title: d.title, body: d.body, seoTitle: d.seoTitle || null, seoDescription: d.seoDescription || null, isPublished: d.isPublished === 'on', sortOrder: d.sortOrder };
    const page = await prisma.contentPage.upsert({ where: { slug }, create: { slug, ...data }, update: data });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'content.page.save', entityType: 'ContentPage', entityId: page.id, before: before ? { title: before.title, body: before.body.slice(0, 2000) } : undefined, after: { title: d.title, body: d.body.slice(0, 2000) } });
    revalidatePath(`/info/${slug}`);
    return undefined;
  });
}

export async function saveFaqAction(formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('content.write');
  return runAction(async () => {
    const id = String(formData.get('id') ?? '');
    const data = { question: String(formData.get('question') ?? '').trim(), answer: String(formData.get('answer') ?? '').trim(), category: String(formData.get('category') ?? 'Общие').trim() || 'Общие', sortOrder: Number(formData.get('sortOrder') ?? 0) || 0, isActive: formData.get('isActive') === 'on' };
    if (!data.question || !data.answer) throw new Error('Заполните вопрос и ответ');
    const item = id ? await prisma.faqItem.update({ where: { id }, data }) : await prisma.faqItem.create({ data });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'content.faq.save', entityType: 'FaqItem', entityId: item.id, after: data });
    revalidatePath('/help');
    return undefined;
  });
}

export async function deleteFaqAction(id: string): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('content.write');
  return runAction(async () => {
    await prisma.faqItem.delete({ where: { id } });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'content.faq.delete', entityType: 'FaqItem', entityId: id });
    revalidatePath('/help');
    return undefined;
  });
}

export async function saveBrandAction(formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('content.write');
  return runAction(async () => {
    const name = String(formData.get('name') ?? '').trim();
    if (!name) throw new Error('Название бренда обязательно');
    const slug = slugify(String(formData.get('slug') ?? '') || name);
    const data: Prisma.ProductBrandUncheckedCreateInput = { slug, name, isPopular: formData.get('isPopular') === 'on', sortOrder: Number(formData.get('sortOrder') ?? 100) || 100, description: String(formData.get('description') ?? '') || null, isActive: true };
    const b = await prisma.productBrand.upsert({ where: { slug }, create: data, update: { name: data.name, isPopular: data.isPopular, sortOrder: data.sortOrder, description: data.description } });
    await writeAudit(prisma, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'content.brand.save', entityType: 'ProductBrand', entityId: b.id, after: data });
    revalidatePath('/', 'layout');
    return undefined;
  });
}
