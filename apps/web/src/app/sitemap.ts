import type { MetadataRoute } from 'next';
import { getEnv } from '@techmatch/config';
import { prisma } from '@techmatch/database';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getEnv().APP_URL;
  const [products, devices, categories, brands, pages, bundles] = await Promise.all([
    prisma.product.findMany({ where: { status: 'ACTIVE' }, select: { slug: true, updatedAt: true } }),
    prisma.deviceModel.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
    prisma.accessoryCategory.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
    prisma.productBrand.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
    prisma.contentPage.findMany({ where: { isPublished: true }, select: { slug: true, updatedAt: true } }),
    prisma.bundle.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
  ]);
  return [
    { url: base, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/catalog`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/devices`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/bundles`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/brands`, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${base}/help`, changeFrequency: 'monthly', priority: 0.4 },
    ...products.map((p) => ({ url: `${base}/product/${p.slug}`, lastModified: p.updatedAt, changeFrequency: 'weekly' as const, priority: 0.8 })),
    ...devices.map((d) => ({ url: `${base}/device/${d.slug}`, lastModified: d.updatedAt, changeFrequency: 'weekly' as const, priority: 0.8 })),
    ...categories.map((c) => ({ url: `${base}/category/${c.slug}`, lastModified: c.updatedAt, changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...brands.map((b) => ({ url: `${base}/brand/${b.slug}`, lastModified: b.updatedAt, changeFrequency: 'weekly' as const, priority: 0.5 })),
    ...bundles.map((b) => ({ url: `${base}/bundles/${b.slug}`, lastModified: b.updatedAt, changeFrequency: 'weekly' as const, priority: 0.6 })),
    ...pages.map((p) => ({ url: `${base}/info/${p.slug}`, lastModified: p.updatedAt, changeFrequency: 'monthly' as const, priority: 0.3 })),
  ];
}
