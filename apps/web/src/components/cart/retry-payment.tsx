'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { retryPaymentAction } from '@/server/actions/checkout';
import { useToast } from '@/components/ui/toast';

export function RetryPayment({ orderId, url }: { orderId: string; url: string | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn btn-primary"
      disabled={pending}
      data-testid="pay-now"
      onClick={() =>
        start(async () => {
          if (url) return router.push(url);
          const r = await retryPaymentAction(orderId);
          if (r.ok && r.data.url) router.push(r.data.url);
          else toast.error(r.ok ? 'Не удалось создать платёж' : r.error);
        })
      }
    >
      {pending ? <Loader2 width={16} height={16} className="animate-spin" /> : <CreditCard width={16} height={16} />} Оплатить
    </button>
  );
}
