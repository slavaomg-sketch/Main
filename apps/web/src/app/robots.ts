import type { MetadataRoute } from 'next';
import { getEnv } from '@techmatch/config';

export default function robots(): MetadataRoute.Robots {
  const env = getEnv();
  if (!env.SEO_INDEXING_ENABLED) return { rules: { userAgent: '*', disallow: '/' } };
  return { rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/account', '/cart', '/checkout', '/order/', '/api/', '/mock-payment/', '/search'] }, sitemap: `${env.APP_URL}/sitemap.xml` };
}
