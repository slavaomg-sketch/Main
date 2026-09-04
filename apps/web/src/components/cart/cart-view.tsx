'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Loader2, Minus, Plus, Trash2 } from 'lucide-react';
import type { CartDTO } from '@techmatch/domain';
import { formatRub } from '@techmatch/domain/shared/money';
import { CompatBadge } from '@/components/ui/compat-badge';
import { applyCouponAction, removeCartItemAction, updateCartItemAction } from '@/server/actions/cart';
import { useToast } from '@/components/ui/toast';
import { useRouter } from 'next/navigation';

export function CartView({ cart }: { cart: CartDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [coupon, setCoupon] = useState(cart.couponCode ?? '');
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? 'Ошибка');
      router.refresh();
    });
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]" data-testid="cart">
      <ul className="card divide-y divide-ink-200" aria-busy={pending}>
        {cart.lines.map((l) => (
          <li key={l.id} className="flex gap-3 p-4 sm:gap-4" data-testid="cart-line">
            <Link href={`/product/${l.productSlug}`} className="relative size-20 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-ink-100 sm:size-24">
              {l.imageUrl && <Image src={l.imageVariants.thumb ?? l.imageUrl} alt="" fill sizes="96px" className="object-cover" />}
            </Link>
            <div className="min-w-0 flex-1">
              <Link href={`/product/${l.productSlug}`} className="line-clamp-2 text-[14px] font-medium hover:text-brand-600">{l.name}</Link>
              <div className="mt-0.5 text-[12px] text-ink-500">{l.variantName !== l.name ? `${l.variantName} · ` : ''}арт. {l.sku}</div>
              {l.compatibility && <div className="mt-1.5"><CompatBadge status={l.compatibility.status} short /></div>}
              {l.available < l.quantity && <p className="mt-1 text-[12px] text-danger-500">Доступно только {l.available} шт.</p>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex h-9 items-center rounded-[var(--radius-pill)] border border-ink-300">
                  <button type="button" className="inline-flex size-9 items-center justify-center hover:bg-ink-100" aria-label="Меньше" disabled={pending} onClick={() => act(() => updateCartItemAction(l.id, l.quantity - 1))}><Minus width={14} height={14} /></button>
                  <span className="w-7 text-center text-[13px] font-semibold" data-testid="line-qty">{l.quantity}</span>
                  <button type="button" className="inline-flex size-9 items-center justify-center hover:bg-ink-100" aria-label="Больше" disabled={pending || l.quantity >= l.available} onClick={() => act(() => updateCartItemAction(l.id, l.quantity + 1))}><Plus width={14} height={14} /></button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[15px] font-bold">{formatRub(l.lineTotalMinor)}</span>
                  <button type="button" className="icon-btn size-9 text-ink-400 hover:text-danger-500" aria-label="Удалить" disabled={pending} onClick={() => act(() => removeCartItemAction(l.id))}><Trash2 width={16} height={16} /></button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <aside className="card h-fit p-5 lg:sticky lg:top-32">
        <h2 className="h3 mb-3">Итого</h2>
        <form
          className="mb-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => applyCouponAction(coupon.trim() || null));
          }}
        >
          <input className="input min-h-10 uppercase" placeholder="Промокод" value={coupon} onChange={(e) => setCoupon(e.target.value)} aria-label="Промокод" data-testid="coupon-input" />
          <button type="submit" className="btn btn-outline btn-sm min-h-10" disabled={pending}>{pending ? <Loader2 width={14} height={14} className="animate-spin" /> : 'Применить'}</button>
        </form>
        {cart.couponError && <p className="-mt-2 mb-3 text-[12px] text-danger-500">{cart.couponError}</p>}
        {cart.couponDescription && <p className="-mt-2 mb-3 text-[12px] text-success-500">{cart.couponDescription} по промокоду {cart.couponCode}</p>}
        <dl className="space-y-1.5 text-[13.5px]">
          <div className="flex justify-between"><dt className="text-ink-600">Товары ({cart.itemCount})</dt><dd>{formatRub(cart.totals.subtotalMinor)}</dd></div>
          {cart.bundleDiscounts.map((b) => (
            <div key={b.bundleId} className="flex justify-between text-success-500"><dt>Комплект «{b.name}»</dt><dd>−{formatRub(b.discountMinor)}</dd></div>
          ))}
          {cart.totals.discountMinor > 0 && <div className="flex justify-between text-success-500"><dt>Промокод</dt><dd>−{formatRub(cart.totals.discountMinor)}</dd></div>}
          <div className="flex justify-between"><dt className="text-ink-600">Доставка</dt><dd className="text-ink-500">рассчитаем при оформлении</dd></div>
        </dl>
        <div className="mt-3 flex items-baseline justify-between border-t border-ink-200 pt-3">
          <span className="text-[15px] font-semibold">К оплате</span>
          <span className="text-[22px] font-bold" data-testid="cart-total">{formatRub(cart.totals.totalMinor)}</span>
        </div>
        <Link href="/checkout" className="btn btn-primary mt-4 w-full" data-testid="go-checkout">Оформить заказ</Link>
        <p className="mt-3 text-center text-[12px] text-ink-500">Бесплатная доставка от 3 000 ₽</p>
      </aside>
    </div>
  );
}
