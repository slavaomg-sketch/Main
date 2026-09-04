import 'server-only';
import { redirect } from 'next/navigation';
import { hasPermission, type AdminContext, type Permission } from '@techmatch/domain';
import { getAdmin } from '@/lib/session';

/** Гарантирует вход в админку и наличие права; иначе редирект на /admin/login или 403-страницу. */
export async function requireAdmin(permission?: Permission): Promise<AdminContext> {
  const admin = await getAdmin();
  if (!admin) redirect('/admin/login');
  if (permission && !hasPermission(admin, permission)) redirect('/admin/forbidden');
  return admin;
}
