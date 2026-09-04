import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { CreatePaymentInput, CreatePaymentResult, PaymentProvider, PaymentWebhookEvent, RefundInput, RefundResult } from './types.js';

/**
 * MockPaymentProvider — тестовая оплата для разработки.
 * Создаёт платёж в статусе PENDING и ведёт на локальную страницу /mock-payment/[id],
 * где можно нажать «Оплатить» или «Отклонить». Страница отправляет подписанный webhook.
 * Никогда не притворяется реальной оплатой: mode = 'mock'.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly code = 'mock' as const;
  readonly mode = 'mock' as const;
  private readonly statuses = new Map<string, 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'>();

  constructor(private readonly opts: { appUrl: string; webhookSecret: string }) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const providerPaymentId = `mock_${randomUUID()}`;
    this.statuses.set(providerPaymentId, 'PENDING');
    const url = new URL(`/mock-payment/${providerPaymentId}`, this.opts.appUrl);
    url.searchParams.set('order', input.orderPublicId);
    url.searchParams.set('amount', String(input.amountMinor));
    url.searchParams.set('return', input.returnUrl);
    return { providerPaymentId, status: 'PENDING', confirmationUrl: url.toString() };
  }

  sign(payload: string): string {
    return createHmac('sha256', this.opts.webhookSecret).update(payload).digest('hex');
  }

  async parseWebhook(request: { headers: Record<string, string | undefined>; rawBody: string }): Promise<PaymentWebhookEvent | null> {
    const sig = request.headers['x-mock-signature'] ?? request.headers['X-Mock-Signature'];
    if (!sig) return null;
    const expected = Buffer.from(this.sign(request.rawBody), 'hex');
    const given = Buffer.from(sig, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    let body: { eventId?: string; paymentId?: string; event?: string; amountMinor?: number };
    try {
      body = JSON.parse(request.rawBody);
    } catch {
      return null;
    }
    if (!body.eventId || !body.paymentId || !body.event) return null;
    const type: PaymentWebhookEvent['type'] =
      body.event === 'succeeded' ? 'payment.succeeded' : body.event === 'canceled' ? 'payment.canceled' : 'unknown';
    if (type === 'payment.succeeded') this.statuses.set(body.paymentId, 'SUCCEEDED');
    if (type === 'payment.canceled') this.statuses.set(body.paymentId, 'FAILED');
    return { providerEventId: body.eventId, providerPaymentId: body.paymentId, type, amountMinor: body.amountMinor, raw: body };
  }

  async getPaymentStatus(providerPaymentId: string) {
    return this.statuses.get(providerPaymentId) ?? 'PENDING';
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return { providerRefundId: `mock_refund_${input.idempotencyKey}`, status: 'SUCCEEDED' };
  }
}
