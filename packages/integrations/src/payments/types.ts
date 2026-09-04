export type PaymentProviderCode = 'mock' | 'yookassa';

export interface CreatePaymentInput {
  orderId: string;
  orderPublicId: string;
  amountMinor: number;
  currency: string;
  description: string;
  returnUrl: string;
  customerEmail: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  status: 'PENDING' | 'AUTHORIZED' | 'SUCCEEDED' | 'FAILED';
  confirmationUrl: string | null;
  raw?: unknown;
}

export interface PaymentWebhookEvent {
  providerEventId: string;
  providerPaymentId: string;
  type: 'payment.succeeded' | 'payment.canceled' | 'payment.waiting_for_capture' | 'refund.succeeded' | 'unknown';
  amountMinor?: number;
  raw: unknown;
}

export interface RefundInput {
  providerPaymentId: string;
  amountMinor: number;
  idempotencyKey: string;
  reason?: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
}

export interface PaymentProvider {
  readonly code: PaymentProviderCode;
  readonly mode: 'mock' | 'live';
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Проверка подписи/источника и разбор webhook. Возвращает null, если запрос невалиден. */
  parseWebhook(request: { headers: Record<string, string | undefined>; rawBody: string; ip?: string }): Promise<PaymentWebhookEvent | null>;
  getPaymentStatus(providerPaymentId: string): Promise<'PENDING' | 'AUTHORIZED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'>;
  refund(input: RefundInput): Promise<RefundResult>;
}
