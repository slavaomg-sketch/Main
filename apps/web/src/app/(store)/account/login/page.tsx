import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/account/auth-forms';
import { getCustomer } from '@/lib/session';

export const metadata: Metadata = { title: 'Вход', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCustomer()) redirect('/account');
  const { next } = await searchParams;
  return <div className="shell py-8"><LoginForm next={next} /></div>;
}
