'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@techmatch/database';
import { createAdminUser, updateAdminUser } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { runAction, type ActionResult } from '@/lib/errors';

const createSchema = z.object({ email: z.email(), name: z.string().trim().min(2).max(80), password: z.string().min(10, 'Пароль не короче 10 символов'), roleCode: z.string().min(1) });
const updateSchema = z.object({ id: z.string().min(1), name: z.string().trim().min(2).max(80).optional(), roleCode: z.string().optional(), isActive: z.string().optional(), password: z.string().optional() });

export async function createAdminUserAction(formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('users.write');
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  return runAction(async () => {
    await createAdminUser(prisma, admin, parsed.data);
    revalidatePath('/admin/users');
    return undefined;
  });
}

export async function updateAdminUserAction(formData: FormData): Promise<ActionResult<undefined>> {
  const admin = await requireAdmin('users.write');
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  const d = parsed.data;
  return runAction(async () => {
    await updateAdminUser(prisma, admin, d.id, { name: d.name, roleCode: d.roleCode, isActive: d.isActive === 'on', password: d.password || undefined });
    revalidatePath('/admin/users');
    return undefined;
  });
}
