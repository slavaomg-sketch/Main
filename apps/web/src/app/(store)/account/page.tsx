import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { formatRub } from '@techmatch/domain';
import { AccountShell } from '@/components/account/account-shell';
import { PasswordForm, ProfileForm } from '@/components/account/profile-forms';
import { OrderStatusBadge } from '@/components/cart/order-status';
import { getCustomer } from '@/lib/session';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Личный кабинет', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const session = await getCustomer();
  if (!session) redirect('/account/login?next=/account');
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: session.customer.id }, include: { orders: { orderBy: { createdAt: 'desc' }, take: 3 }, devices: { include: { deviceModel: true }, orderBy: { isPrimary: 'desc' } } } });
  return (
    <AccountShell title={`Здравствуйте, ${customer.firstName ?? customer.email}!`} current="/account">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card p-5">
          <h2 className="h3 mb-2">Мои устройства</h2>
          {customer.devices.length ? (
            <ul className="space-y-1 text-[13.5px]">{customer.devices.slice(0, 4).map((d) => <li key={d.id}><Link href={`/device/${d.deviceModel.slug}`} className="hover:text-brand-600">{d.deviceModel.fullName}</Link>{d.isPrimary && <span className="ml-2 badge bg-brand-50 text-brand-600">активное</span>}</li>)}</ul>
          ) : <p className="text-[13px] text-ink-500">Пока нет сохранённых устройств.</p>}
          <Link href="/account/devices" className="btn btn-outline btn-sm mt-3">Управлять</Link>
        </section>
        <section className="card p-5">
          <h2 className="h3 mb-2">Последние заказы</h2>
          {customer.orders.length ? (
            <ul className="space-y-2 text-[13.5px]">{customer.orders.map((o) => <li key={o.id} className="flex items-center justify-between gap-2"><Link href={`/order/${o.publicId}`} className="font-medium hover:text-brand-600">{o.publicId}</Link><span className="text-ink-500">{formatDate(o.createdAt)}</span><span>{formatRub(o.totalMinor)}</span><OrderStatusBadge status={o.status} /></li>)}</ul>
          ) : <p className="text-[13px] text-ink-500">Заказов пока нет.</p>}
          <Link href="/account/orders" className="btn btn-outline btn-sm mt-3">Все заказы</Link>
        </section>
      </div>
      <div className="mt-4 space-y-4">
        <ProfileForm customer={customer} />
        <PasswordForm />
      </div>
    </AccountShell>
  );
}
