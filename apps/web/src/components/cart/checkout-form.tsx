'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatRub } from '@techmatch/domain/shared/money';
import type { CartDTO } from '@techmatch/domain';
import { placeOrderAction, quoteDeliveryAction, type CheckoutFormState } from '@/server/actions/checkout';

interface Quote {
  methodCode: string;
  name: string;
  description: string;
  costMinor: number;
}

export function CheckoutForm({ cart, defaults, loggedIn, paymentMode }: { cart: CartDTO; defaults: { fullName: string; phone: string; email: string; city: string; street: string; building: string; apartment: string; postalCode: string }; loggedIn: boolean; paymentMode: 'mock' | 'live' }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<CheckoutFormState, FormData>(placeOrderAction, null);
  const [city, setCity] = useState(defaults.city || 'Москва');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [method, setMethod] = useState('');
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const idempotencyKey = useMemo(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}${Math.random().toString(36).slice(2)}`), []);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      setLoadingQuotes(true);
      const r = await quoteDeliveryAction(city);
      if (!alive) return;
      if (r.ok) {
        setQuotes(r.data);
        setMethod((m) => (r.data.some((q) => q.methodCode === m) ? m : (r.data[0]?.methodCode ?? '')));
      }
      setLoadingQuotes(false);
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [city]);

  useEffect(() => {
    if (state?.ok) router.push(state.data.paymentUrl ?? `/order/${state.data.publicId}`);
  }, [state, router]);

  const delivery = quotes.find((q) => q.methodCode === method)?.costMinor ?? 0;
  const total = cart.totals.totalMinor + delivery;
  const field = (name: string, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <label className="label" htmlFor={`f-${name}`}>{label}</label>
      <input id={`f-${name}`} name={name} className="input" defaultValue={(defaults as Record<string, string>)[name] ?? ''} {...props} />
    </div>
  );
  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]" data-testid="checkout-form">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="space-y-5">
        <section className="card p-5">
          <h2 className="h3 mb-4">1. Контактные данные</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {field('fullName', 'Имя и фамилия', { required: true, autoComplete: 'name' })}
            {field('phone', 'Телефон', { required: true, type: 'tel', autoComplete: 'tel', placeholder: '+7 900 000-00-00' })}
            <div className="sm:col-span-2">{field('email', 'Email', { required: true, type: 'email', autoComplete: 'email' })}</div>
          </div>
        </section>
        <section className="card p-5">
          <h2 className="h3 mb-4">2. Адрес доставки</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="f-city">Город</label>
              <input id="f-city" name="city" className="input" required autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            {field('region', 'Регион (необязательно)', { autoComplete: 'address-level1' })}
            <div className="sm:col-span-2">{field('street', 'Улица', { required: true, autoComplete: 'address-line1' })}</div>
            {field('building', 'Дом', { required: true })}
            {field('apartment', 'Квартира / офис')}
            {field('postalCode', 'Индекс', { autoComplete: 'postal-code', inputMode: 'numeric' })}
          </div>
          {loggedIn && (
            <label className="mt-4 flex items-center gap-2 text-[13px]"><input type="checkbox" name="saveAddress" className="size-4 accent-brand-500" /> Сохранить адрес в личном кабинете</label>
          )}
        </section>
        <section className="card p-5">
          <h2 className="h3 mb-4">3. Способ доставки</h2>
          {loadingQuotes && quotes.length === 0 ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-500"><Loader2 width={16} height={16} className="animate-spin" /> Рассчитываем доставку…</p>
          ) : (
            <div className="space-y-2" role="radiogroup" aria-label="Способ доставки">
              {quotes.map((q) => (
                <label key={q.methodCode} className={`flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border p-3 ${method === q.methodCode ? 'border-brand-500 bg-brand-50' : 'border-ink-200 hover:border-ink-300'}`}>
                  <input type="radio" name="deliveryMethodCode" value={q.methodCode} checked={method === q.methodCode} onChange={() => setMethod(q.methodCode)} className="size-4 accent-brand-500" />
                  <span className="flex-1">
                    <span className="block text-[14px] font-medium">{q.name}</span>
                    <span className="block text-[12px] text-ink-500">{q.description}</span>
                  </span>
                  <span className="text-[14px] font-semibold">{q.costMinor === 0 ? 'Бесплатно' : formatRub(q.costMinor)}</span>
                </label>
              ))}
            </div>
          )}
        </section>
        <section className="card p-5">
          <h2 className="h3 mb-3">4. Комментарий к заказу</h2>
          <textarea name="comment" className="input min-h-20 py-2" placeholder="Код домофона, удобное время, пожелания" maxLength={500} />
        </section>
      </div>
      <aside className="card h-fit p-5 lg:sticky lg:top-32">
        <h2 className="h3 mb-3">Ваш заказ</h2>
        <ul className="mb-3 max-h-56 space-y-1.5 overflow-y-auto text-[13px]">
          {cart.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-2"><span className="truncate">{l.name} × {l.quantity}</span><span className="shrink-0">{formatRub(l.lineTotalMinor)}</span></li>
          ))}
        </ul>
        <dl className="space-y-1.5 border-t border-ink-200 pt-3 text-[13.5px]">
          <div className="flex justify-between"><dt className="text-ink-600">Товары</dt><dd>{formatRub(cart.totals.subtotalMinor)}</dd></div>
          {cart.totals.promotionDiscountMinor > 0 && <div className="flex justify-between text-success-500"><dt>Скидка за комплект</dt><dd>−{formatRub(cart.totals.promotionDiscountMinor)}</dd></div>}
          {cart.totals.discountMinor > 0 && <div className="flex justify-between text-success-500"><dt>Промокод {cart.couponCode}</dt><dd>−{formatRub(cart.totals.discountMinor)}</dd></div>}
          <div className="flex justify-between"><dt className="text-ink-600">Доставка</dt><dd>{delivery === 0 ? 'Бесплатно' : formatRub(delivery)}</dd></div>
        </dl>
        <div className="mt-3 flex items-baseline justify-between border-t border-ink-200 pt-3">
          <span className="text-[15px] font-semibold">К оплате</span>
          <span className="text-[22px] font-bold" data-testid="checkout-total">{formatRub(total)}</span>
        </div>
        {state && !state.ok && <p className="mt-3 rounded-[var(--radius-sm)] bg-danger-100 px-3 py-2 text-[13px] text-danger-500" role="alert" data-testid="checkout-error">{state.error}</p>}
        <button type="submit" className="btn btn-primary mt-4 w-full" disabled={pending || !method} data-testid="place-order">
          {pending ? <Loader2 width={16} height={16} className="animate-spin" /> : null} Перейти к оплате
        </button>
        <p className="mt-3 text-[11.5px] text-ink-500">
          {paymentMode === 'mock' ? 'Тестовый режим оплаты: после подтверждения вы попадёте на страницу эмуляции платежа.' : 'Оплата банковской картой через защищённый шлюз.'} Нажимая кнопку, вы соглашаетесь с <a href="/info/terms" className="underline">условиями</a>.
        </p>
      </aside>
    </form>
  );
}
