import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { getAdmin } from '@/lib/session';
import { AdminShell } from '@/components/admin/shell';
import { ToastProvider } from '@/components/ui/toast';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await getAdmin();
  const h = await headers();
  const current = h.get('x-pathname') ?? '/admin';
  if (!admin) return <>{children}</>; // /admin/login
  return (
    <ToastProvider>
      <AdminShell admin={admin} current={current}>{children}</AdminShell>
    </ToastProvider>
  );
}
