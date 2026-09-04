'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { cancelOrderAction } from '@/server/actions/account';
import { useToast } from '@/components/ui/toast';

export function CancelOrderButton({ orderId }: { orderId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <button type="button" className="btn btn-ghost btn-sm text-danger-500" disabled={pending} onClick={() => { if (!confirm('Отменить заказ?')) return; start(async () => { const r = await cancelOrderAction(orderId); if (!r.ok) toast.error(r.error); else toast.success('Заказ отменён'); router.refresh(); }); }}>
      Отменить
    </button>
  );
}
