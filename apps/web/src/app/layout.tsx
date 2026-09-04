import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { getEnv } from '@techmatch/config';
import './globals.css';

const env = getEnv();

export const metadata: Metadata = {
  metadataBase: new URL(env.APP_URL),
  title: { default: 'TechMatch — правильные аксессуары для любых устройств', template: '%s — TechMatch' },
  description: 'Укажите своё устройство — TechMatch подберёт только совместимые зарядки, кабели, чехлы, картриджи и другие аксессуары и объяснит, почему они подходят.',
  applicationName: 'TechMatch',
  robots: env.SEO_INDEXING_ENABLED ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: { type: 'website', siteName: 'TechMatch', locale: 'ru_RU' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1a73e8' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
