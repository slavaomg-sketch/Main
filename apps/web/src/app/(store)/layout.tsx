import type { ReactNode } from 'react';
import { prisma } from '@techmatch/database';
import { getHomepageSettings, listAccessoryCategories, listDeviceCategories } from '@techmatch/domain';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { MobileNav } from '@/components/layout/mobile-nav';
import { ToastProvider } from '@/components/ui/toast';
import { getActiveDevice, getCartDTO, getCustomer } from '@/lib/session';
import { getGuestFavoriteIds } from '@/lib/favorites';

export default async function StoreLayout({ children }: { children: ReactNode }) {
  const [settings, categories, deviceCategories, cart, customer, activeDevice] = await Promise.all([getHomepageSettings(prisma), listAccessoryCategories(prisma), listDeviceCategories(prisma), getCartDTO(), getCustomer(), getActiveDevice()]);
  const favoritesCount = customer ? await prisma.favorite.count({ where: { customerId: customer.customer.id } }) : (await getGuestFavoriteIds()).length;
  const org = { '@context': 'https://schema.org', '@type': 'Organization', name: 'TechMatch', url: process.env.APP_URL ?? 'http://localhost:3000', logo: `${process.env.APP_URL ?? 'http://localhost:3000'}/icon.svg` };
  return (
    <ToastProvider>
      <Header
        data={{
          cartCount: cart?.itemCount ?? 0,
          favoritesCount,
          isLoggedIn: Boolean(customer),
          benefits: settings.headerBenefits,
          categories: categories.filter((c) => !c.parentId).map((c) => ({ slug: c.slug, name: c.name, icon: c.icon, children: c.children.map((ch) => ({ slug: ch.slug, name: ch.name })) })),
          deviceCategories: deviceCategories.map((c) => ({ slug: c.slug, name: c.name, icon: c.icon })),
          activeDevice: activeDevice ? { slug: activeDevice.slug, name: activeDevice.name } : null,
        }}
      />
      <main id="main" className="min-h-[60vh]">{children}</main>
      <Footer trustTitle={settings.trustTitle} trustText={settings.trustText} />
      <MobileNav cartCount={cart?.itemCount ?? 0} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(org) }} />
    </ToastProvider>
  );
}
