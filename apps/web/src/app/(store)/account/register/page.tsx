import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { RegisterForm } from '@/components/account/auth-forms';
import { getCustomer } from '@/lib/session';

export const metadata: Metadata = { title: 'Регистрация', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCustomer()) redirect('/account');
  const { next } = await searchParams;
  return <div className="shell py-8"><RegisterForm next={next} /></div>;
}
