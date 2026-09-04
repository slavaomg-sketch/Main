import type { DbClient, Prisma } from '@techmatch/database';
import { NotFoundError } from '../shared/errors.js';

/** Настройки главной страницы (управляются из админки, раздел «Контент»). */
export interface HomepageSettings {
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  heroSearchPlaceholder: string;
  heroNote: string;
  popularQueries: string[];
  advantages: Array<{ icon: string; title: string; text: string }>;
  headerBenefits: Array<{ icon: string; title: string; text: string }>;
  newsletterTitle: string;
  newsletterText: string;
  trustTitle: string;
  trustText: string;
  featuredCollectionSlug: string;
  bundlesLimit: number;
}

export const DEFAULT_HOMEPAGE: HomepageSettings = {
  heroEyebrow: 'Одно устройство. Безграничные возможности.',
  heroTitle: 'Правильные аксессуары для любых устройств',
  heroSubtitle: 'Укажите, что у вас есть — мы подберем только совместимые аксессуары. Быстро, удобно, надежно.',
  heroSearchPlaceholder: 'Введите тип устройства или модель...',
  heroNote: 'Технологии работают лучше, когда всё подходит',
  popularQueries: ['Телефон', 'Ноутбук', 'Планшет', 'Принтер', 'Наушники'],
  advantages: [
    { icon: 'shield-check', title: 'Только совместимые товары', text: 'Мы проверяем совместимость по техническим характеристикам' },
    { icon: 'truck', title: 'Быстрая доставка', text: 'По всей России от 1 до 5 дней' },
    { icon: 'award', title: 'Надежные бренды', text: 'Оригинальные товары и официальная гарантия' },
    { icon: 'package', title: 'Удобный возврат', text: 'В течение 14 дней' },
    { icon: 'headset', title: 'Экспертная поддержка', text: 'Поможем подобрать и ответим на вопросы' },
  ],
  headerBenefits: [
    { icon: 'truck', title: 'Доставка', text: 'по всей России' },
    { icon: 'shield-check', title: 'Гарантия', text: 'до 24 месяцев' },
    { icon: 'headset', title: 'Помощь экспертов', text: '7 дней в неделю' },
  ],
  newsletterTitle: 'Будьте в курсе',
  newsletterText: 'Подпишитесь на новости, акции и новые поступления.',
  trustTitle: 'Надежный магазин',
  trustText: 'Тысячи довольных клиентов по всей России',
  featuredCollectionSlug: 'popular',
  bundlesLimit: 3,
};

export async function getSetting<T>(db: DbClient, key: string, fallback: T): Promise<T> {
  const row = await db.siteSetting.findUnique({ where: { key } });
  if (!row) return fallback;
  return { ...(fallback as object), ...(row.value as object) } as T;
}

export async function setSetting(db: DbClient, key: string, value: unknown) {
  return db.siteSetting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } });
}

export const getHomepageSettings = (db: DbClient) => getSetting<HomepageSettings>(db, 'homepage', DEFAULT_HOMEPAGE);

export async function listBanners(db: DbClient, placement?: 'HOME_HERO' | 'HOME_PROMO' | 'HOME_WIDE' | 'CATALOG_TOP' | 'DEVICE_PAGE', now = new Date()) {
  return db.banner.findMany({
    where: { isActive: true, ...(placement ? { placement } : {}), OR: [{ startsAt: null }, { startsAt: { lte: now } }], AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] },
    orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }],
    include: { imageAsset: true },
  });
}

export async function getCollectionWithProducts(db: DbClient, slug: string, limit = 12) {
  const c = await db.collection.findUnique({ where: { slug }, include: { items: { orderBy: { sortOrder: 'asc' }, take: limit, select: { productId: true } } } });
  if (!c || !c.isActive) return null;
  return { collection: c, productIds: c.items.map((i) => i.productId) };
}

export async function listContentPages(db: DbClient) {
  return db.contentPage.findMany({ where: { isPublished: true }, orderBy: { sortOrder: 'asc' }, select: { slug: true, title: true } });
}

export async function getContentPage(db: DbClient, slug: string) {
  const p = await db.contentPage.findUnique({ where: { slug } });
  if (!p || !p.isPublished) throw new NotFoundError('Страница', slug);
  return p;
}

export async function listFaq(db: DbClient) {
  const rows = await db.faqItem.findMany({ where: { isActive: true }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] });
  const grouped = new Map<string, typeof rows>();
  for (const r of rows) grouped.set(r.category, [...(grouped.get(r.category) ?? []), r]);
  return Array.from(grouped, ([category, items]) => ({ category, items }));
}

export async function subscribeNewsletter(db: DbClient, input: { email: string; name?: string | null; source?: string }) {
  const email = input.email.trim().toLowerCase();
  return db.newsletterSubscriber.upsert({ where: { email }, create: { email, name: input.name ?? null, source: input.source ?? 'homepage' }, update: { name: input.name ?? undefined } });
}
