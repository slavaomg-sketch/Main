import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LogoMark } from '@/components/ui/logo';
import { AdminLoginForm } from './form';
import { getAdmin } from '@/lib/session';

export const metadata: Metadata = { title: 'Вход в панель управления', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getAdmin()) redirect('/admin');
  const { next } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2"><LogoMark /><span className="text-[20px] font-extrabold">TechMatch Admin</span></div>
        <AdminLoginForm next={next} />
      </div>
    </div>
  );
}
