import type { Metadata } from 'next';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { prisma } from '@techmatch/database';
import { getProductCardsByIds, listFavorites } from '@techmatch/domain';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { ProductGrid } from '@/components/catalog/product-grid';
import { EmptyState } from '@/components/ui/empty';
import { getActiveDeviceId, getCustomer } from '@/lib/session';
import { getGuestFavoriteIds } from '@/lib/favorites';

export const metadata: Metadata = { title: 'Избранное', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function FavoritesPage() {
  const [customer, deviceId] = await Promise.all([getCustomer(), getActiveDeviceId()]);
  const ids = customer ? await listFavorites(prisma, customer.customer.id) : await getGuestFavoriteIds();
  const products = await getProductCardsByIds(prisma, ids, deviceId);
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: 'Избранное' }]} />
      <h1 className="h2 mb-4">Избранное</h1>
      {products.length ? <ProductGrid products={products} favorites={ids} deviceModelId={deviceId} cols={5} /> : <EmptyState icon={<Heart width={26} height={26} />} title="В избранном пока пусто" text="Нажимайте на сердечко в карточке товара, чтобы вернуться к нему позже." action={<Link href="/catalog" className="btn btn-primary">В каталог</Link>} />}
      {!customer && products.length > 0 && <p className="mt-4 text-[13px] text-ink-500">Избранное хранится в этом браузере. <Link href="/account/login" className="text-brand-500 underline">Войдите</Link>, чтобы синхронизировать его с аккаунтом.</p>}
    </div>
  );
}
