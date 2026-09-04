'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { mockPaymentDecisionAction } from './actions';

export function MockPayButtons({ paymentId, amountMinor, returnUrl }: { paymentId: string; amountMinor: number; returnUrl: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const decide = (event: 'succeeded' | 'canceled') =>
    start(async () => {
      const r = await mockPaymentDecisionAction({ paymentId, event, amountMinor });
      if (!r.ok) return setError(r.error);
      router.push(`${returnUrl}${event === 'succeeded' ? '?paid=1' : ''}`);
    });
  return (
    <div className="mt-5 space-y-2">
      <button type="button" className="btn btn-primary w-full" disabled={pending} onClick={() => decide('succeeded')} data-testid="mock-pay-success">
        {pending ? <Loader2 width={16} height={16} className="animate-spin" /> : null} Оплатить (успех)
      </button>
      <button type="button" className="btn btn-outline w-full" disabled={pending} onClick={() => decide('canceled')} data-testid="mock-pay-fail">
        Отклонить платёж (ошибка)
      </button>
      {error && <p className="text-[13px] text-danger-500">{error}</p>}
      <p className="text-[11.5px] text-ink-500">Кнопки отправляют подписанный webhook на /api/webhooks/payments/mock — так же, как это сделал бы реальный провайдер.</p>
    </div>
  );
}
