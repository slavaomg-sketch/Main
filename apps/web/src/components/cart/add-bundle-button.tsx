'use client';

import { useTransition } from 'react';
import { Loader2, ShoppingCart } from 'lucide-react';
import { addToCartAction } from '@/server/actions/cart';
import { useToast } from '@/components/ui/toast';

export function AddBundleButton({ items, disabled }: { items: Array<{ variantId: string; quantity: number }>; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <button
      type="button"
      disabled={disabled || pending}
      className="btn btn-dark btn-sm"
      onClick={() =>
        start(async () => {
          for (const it of items) {
            const r = await addToCartAction({ variantId: it.variantId, quantity: it.quantity });
            if (!r.ok) return toast.error(r.error);
          }
          toast.success('Комплект добавлен в корзину', { href: '/cart', label: 'В корзину' });
        })
      }
    >
      {pending ? <Loader2 width={15} height={15} className="animate-spin" /> : <ShoppingCart width={15} height={15} />} В корзину
    </button>
  );
}
