'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@techmatch/database';
import { loginAdmin, logoutAdmin } from '@techmatch/domain';
import { ADMIN_COOKIE, cookieOptions, requestMeta } from '@/lib/session';
import { rateLimit } from '@/lib/rate-limit';
import { toActionError, type ActionResult } from '@/lib/errors';
import { getEnv } from '@techmatch/config';

const schema = z.object({ email: z.email(), password: z.string().min(1), next: z.string().optional() });

export async function adminLoginAction(_prev: ActionResult<undefined> | null, formData: FormData): Promise<ActionResult<undefined>> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: 'Укажите email и пароль' };
  const meta = await requestMeta();
  const rl = await rateLimit(`admin-login:${meta.ip ?? 'anon'}`, { max: 8, windowSeconds: 300 });
  if (!rl.ok) return { ok: false, error: 'Слишком много попыток. Подождите 5 минут.' };
  try {
    const { token } = await loginAdmin(prisma, { email: parsed.data.email, password: parsed.data.password, ...meta });
    (await cookies()).set(ADMIN_COOKIE, token, cookieOptions(getEnv().ADMIN_SESSION_TTL_HOURS * 3600));
  } catch (e) {
    return toActionError(e);
  }
  const next = parsed.data.next;
  redirect(next && next.startsWith('/admin') ? next : '/admin');
}

export async function adminLogoutAction() {
  const jar = await cookies();
  await logoutAdmin(prisma, jar.get(ADMIN_COOKIE)?.value);
  jar.delete(ADMIN_COOKIE);
  redirect('/admin/login');
}
