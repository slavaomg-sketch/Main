import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@techmatch/database';
import { getPaymentProvider, handlePaymentWebhook } from '@techmatch/domain';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Webhook платёжного провайдера. Подпись/источник проверяет провайдер (parseWebhook),
 * идемпотентность — уникальный (provider, providerEventId) в PaymentEvent.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const active = getPaymentProvider();
  if (provider !== active.code) return NextResponse.json({ error: 'unknown provider' }, { status: 404 });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined;
  const rl = await rateLimit(`webhook:${provider}:${ip ?? 'anon'}`, { max: 120, windowSeconds: 60 });
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  const rawBody = await req.text();
  const headers: Record<string, string | undefined> = {};
  req.headers.forEach((v, k) => (headers[k] = v));
  const outcome = await handlePaymentWebhook(prisma, { headers, rawBody, ip });
  if (!outcome.accepted) return NextResponse.json({ error: outcome.message }, { status: 400 });
  return NextResponse.json({ ok: true, duplicate: outcome.duplicate, order: outcome.orderPublicId ?? null });
}
