'use client';

import { useActionState } from 'react';
import { Mail } from 'lucide-react';
import { subscribeAction } from '@/server/actions/newsletter';

export function Newsletter({ title, text }: { title: string; text: string }) {
  const [state, action, pending] = useActionState(subscribeAction, null);
  return (
    <section className="shell py-4" aria-labelledby="newsletter-title">
      <div className="flex flex-col gap-5 rounded-[var(--radius-lg)] bg-tint-sky px-5 py-5 md:flex-row md:items-center md:px-7">
        <div className="flex items-center gap-4">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-surface text-brand-500 shadow-[var(--shadow-card)]"><Mail width={22} height={22} /></span>
          <div>
            <h2 id="newsletter-title" className="text-[18px] font-bold">{title}</h2>
            <p className="text-[12.5px] text-ink-600">{text}</p>
          </div>
        </div>
        <form action={action} className="flex flex-1 flex-col gap-2.5 sm:flex-row md:justify-end">
          <input name="name" className="input sm:max-w-[190px]" placeholder="Ваше имя" aria-label="Ваше имя" autoComplete="given-name" />
          <input name="email" type="email" required className="input sm:max-w-[200px]" placeholder="Ваш email" aria-label="Ваш email" autoComplete="email" />
          <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Отправляем…' : 'Подписаться'}</button>
        </form>
        {state && <p className={`text-[13px] md:absolute md:mt-[110px] ${state.ok ? 'text-success-500' : 'text-danger-500'}`} role="status">{state.ok ? state.data.message : state.error}</p>}
      </div>
    </section>
  );
}
