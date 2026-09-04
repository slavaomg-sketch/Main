'use server';

import { z } from 'zod';
import { prisma } from '@techmatch/database';
import { subscribeNewsletter } from '@techmatch/domain';
import { rateLimit } from '@/lib/rate-limit';
import { requestMeta } from '@/lib/session';
import type { ActionResult } from '@/lib/errors';

const schema = z.object({ email: z.email('Укажите корректный email'), name: z.string().max(80).optional() });

export async function subscribeAction(_prev: ActionResult<{ message: string }> | null, formData: FormData): Promise<ActionResult<{ message: string }>> {
  const parsed = schema.safeParse({ email: formData.get('email'), name: formData.get('name') || undefined });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте данные' };
  const { ip } = await requestMeta();
  const rl = await rateLimit(`newsletter:${ip ?? 'anon'}`, { max: 5, windowSeconds: 600 });
  if (!rl.ok) return { ok: false, error: 'Слишком много попыток, попробуйте позже' };
  await subscribeNewsletter(prisma, { email: parsed.data.email, name: parsed.data.name ?? null });
  return { ok: true, data: { message: 'Спасибо! Вы подписаны на новости TechMatch.' } };
}
