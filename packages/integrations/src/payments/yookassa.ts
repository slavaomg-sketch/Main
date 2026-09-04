import type { CreatePaymentInput, CreatePaymentResult, PaymentProvider, PaymentWebhookEvent, RefundInput, RefundResult } from './types';

/**
 * Адаптер ЮKassa (API v3). Включается только при наличии YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY.
 * Реализация соответствует публичной документации https://yookassa.ru/developers/api,
 * но без ключей ни один запрос не выполняется — фабрика вернёт MockPaymentProvider.
 */
export class YooKassaPaymentProvider implements PaymentProvider {
  readonly code = 'yookassa' as const;
  readonly mode = 'live' as const;
  private readonly base = 'https://api.yookassa.ru/v3';
  // Официальные IP-диапазоны уведомлений ЮKassa (проверяются на входе)
  private readonly trustedCidrs = ['185.71.76.0/27', '185.71.77.0/27', '77.75.153.0/25', '77.75.156.11/32', '77.75.156.35/32', '77.75.154.128/25', '2a02:5180::/32'];

  constructor(private readonly opts: { shopId: string; secretKey: string }) {
    if (!opts.shopId || !opts.secretKey) throw new Error('YooKassa: не заданы ключи');
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const auth = Buffer.from(`${this.opts.shopId}:${this.opts.secretKey}`).toString('base64');
    return {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotence-Key': idempotencyKey } : {}),
    };
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const body = {
      amount: { value: (input.amountMinor / 100).toFixed(2), currency: input.currency },
      capture: true,
      confirmation: { type: 'redirect', return_url: input.returnUrl },
      description: input.description.slice(0, 128),
      metadata: { orderId: input.orderId, orderPublicId: input.orderPublicId, ...(input.metadata ?? {}) },
    };
    const res = await fetch(`${this.base}/payments`, { method: 'POST', headers: this.headers(input.idempotencyKey), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`YooKassa createPayment: HTTP ${res.status}`);
    const data = (await res.json()) as { id: string; status: string; confirmation?: { confirmation_url?: string } };
    const st = mapStatus(data.status);
    return { providerPaymentId: data.id, status: st === 'CANCELLED' ? 'FAILED' : st, confirmationUrl: data.confirmation?.confirmation_url ?? null, raw: data };
  }

  async parseWebhook(request: { headers: Record<string, string | undefined>; rawBody: string; ip?: string }): Promise<PaymentWebhookEvent | null> {
    if (request.ip && !ipInCidrs(request.ip, this.trustedCidrs)) return null;
    let body: { event?: string; object?: { id?: string; amount?: { value?: string }; payment_id?: string } };
    try {
      body = JSON.parse(request.rawBody);
    } catch {
      return null;
    }
    const obj = body.object;
    if (!body.event || !obj?.id) return null;
    // ЮKassa не подписывает уведомления: подтверждаем статус повторным запросом к API
    const paymentId = body.event.startsWith('refund') ? obj.payment_id ?? obj.id : obj.id;
    const verified = await this.getPaymentStatus(paymentId);
    const type: PaymentWebhookEvent['type'] =
      body.event === 'payment.succeeded' && verified === 'SUCCEEDED'
        ? 'payment.succeeded'
        : body.event === 'payment.canceled'
          ? 'payment.canceled'
          : body.event === 'payment.waiting_for_capture'
            ? 'payment.waiting_for_capture'
            : body.event === 'refund.succeeded'
              ? 'refund.succeeded'
              : 'unknown';
    const amountMinor = obj.amount?.value ? Math.round(parseFloat(obj.amount.value) * 100) : undefined;
    return { providerEventId: `${body.event}:${obj.id}`, providerPaymentId: paymentId, type, amountMinor, raw: body };
  }

  async getPaymentStatus(providerPaymentId: string) {
    const res = await fetch(`${this.base}/payments/${providerPaymentId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`YooKassa getPayment: HTTP ${res.status}`);
    const data = (await res.json()) as { status: string };
    return mapStatus(data.status);
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const body = { payment_id: input.providerPaymentId, amount: { value: (input.amountMinor / 100).toFixed(2), currency: 'RUB' }, description: input.reason };
    const res = await fetch(`${this.base}/refunds`, { method: 'POST', headers: this.headers(input.idempotencyKey), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`YooKassa refund: HTTP ${res.status}`);
    const data = (await res.json()) as { id: string; status: string };
    return { providerRefundId: data.id, status: data.status === 'succeeded' ? 'SUCCEEDED' : data.status === 'canceled' ? 'FAILED' : 'PENDING' };
  }
}

function mapStatus(s: string): 'PENDING' | 'AUTHORIZED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' {
  switch (s) {
    case 'succeeded':
      return 'SUCCEEDED';
    case 'waiting_for_capture':
      return 'AUTHORIZED';
    case 'canceled':
      return 'CANCELLED';
    default:
      return 'PENDING';
  }
}

function ipInCidrs(ip: string, cidrs: string[]): boolean {
  if (ip.includes(':')) return cidrs.some((c) => c.includes(':') && ip.toLowerCase().startsWith(c.split('::')[0]!.toLowerCase()));
  const ipNum = ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
  return cidrs.some((cidr) => {
    if (cidr.includes(':')) return false;
    const [range, bitsStr] = cidr.split('/');
    const bits = Number(bitsStr ?? 32);
    const rangeNum = range!.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipNum & mask) === (rangeNum & mask);
  });
}
