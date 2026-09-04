import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { getPaymentProvider, listAddresses, maybeRunInlineMaintenance } from '@techmatch/domain';
import { getEnv } from '@techmatch/config';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { CheckoutForm } from '@/components/cart/checkout-form';
import { getCartDTO, getCustomer } from '@/lib/session';

export const metadata: Metadata = { title: 'Оформление заказа', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  if (getEnv().QUEUE_DRIVER === 'inline') await maybeRunInlineMaintenance(prisma);
  const cart = await getCartDTO();
  if (!cart || cart.lines.length === 0) redirect('/cart');
  const customer = await getCustomer();
  const address = customer ? (await listAddresses(prisma, customer.customer.id))[0] : null;
  const c = customer?.customer;
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: 'Корзина', href: '/cart' }, { label: 'Оформление заказа' }]} />
      <h1 className="h2 mb-4">Оформление заказа</h1>
      <CheckoutForm
        cart={cart}
        loggedIn={Boolean(customer)}
        paymentMode={getPaymentProvider().mode}
        defaults={{
          fullName: address?.fullName ?? [c?.firstName, c?.lastName].filter(Boolean).join(' '),
          phone: address?.phone ?? c?.phone ?? '',
          email: c?.email ?? '',
          city: address?.city ?? '',
          street: address?.street ?? '',
          building: address?.building ?? '',
          apartment: address?.apartment ?? '',
          postalCode: address?.postalCode ?? '',
        }}
      />
    </div>
  );
}
