import type { Metadata } from 'next';
import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { CartView } from '@/components/cart/cart-view';
import { EmptyState } from '@/components/ui/empty';
import { getCartDTO } from '@/lib/session';

export const metadata: Metadata = { title: 'Корзина', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const cart = await getCartDTO();
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: 'Корзина' }]} />
      <h1 className="h2 mb-4">Корзина</h1>
      {cart && cart.lines.length > 0 ? (
        <CartView cart={cart} />
      ) : (
        <EmptyState icon={<ShoppingCart width={26} height={26} />} title="В корзине пока пусто" text="Найдите своё устройство — и мы покажем, что к нему подходит." action={<Link href="/devices" className="btn btn-primary">Подобрать аксессуары</Link>} />
      )}
    </div>
  );
}
