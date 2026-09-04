'use server';

import { randomUUID } from 'node:crypto';
import { getEnv } from '@techmatch/config';
import { prisma } from '@techmatch/database';
import { getPaymentProvider, handlePaymentWebhook } from '@techmatch/domain';
import { MockPaymentProvider } from '@techmatch/integrations';
import type { ActionResult } from '@/lib/errors';

/** Эмулирует webhook провайдера: формирует подписанное тело и прогоняет через тот же обработчик, что и HTTP-endpoint. */
export async function mockPaymentDecisionAction(input: { paymentId: string; event: 'succeeded' | 'canceled'; amountMinor: number }): Promise<ActionResult<undefined>> {
  const provider = getPaymentProvider();
  if (!(provider instanceof MockPaymentProvider)) return { ok: false, error: 'Тестовый провайдер выключен' };
  const body = JSON.stringify({ eventId: `evt_${randomUUID()}`, paymentId: input.paymentId, event: input.event, amountMinor: input.amountMinor });
  const signature = provider.sign(body);
  // Отправляем настоящий HTTP-запрос на webhook, чтобы путь был идентичен production
  try {
    const res = await fetch(`${getEnv().APP_URL}/api/webhooks/payments/mock`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mock-Signature': signature }, body, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    // Если внешний URL недоступен (например, в контейнере), обрабатываем напрямую тем же кодом
    const outcome = await handlePaymentWebhook(prisma, { headers: { 'x-mock-signature': signature }, rawBody: body });
    if (!outcome.accepted) return { ok: false, error: outcome.message };
  }
  return { ok: true, data: undefined };
}
