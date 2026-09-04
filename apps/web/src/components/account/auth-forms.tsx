'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Loader2 } from 'lucide-react';
import { loginAction, registerAction } from '@/server/actions/account';
import type { ActionResult } from '@/lib/errors';

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<ActionResult<undefined> | null, FormData>(loginAction, null);
  return (
    <form action={action} className="card mx-auto w-full max-w-md space-y-4 p-6" data-testid="login-form">
      <h1 className="h2">Вход</h1>
      {next && <input type="hidden" name="next" value={next} />}
      <div><label className="label" htmlFor="l-email">Email</label><input id="l-email" name="email" type="email" className="input" required autoComplete="email" /></div>
      <div><label className="label" htmlFor="l-password">Пароль</label><input id="l-password" name="password" type="password" className="input" required autoComplete="current-password" /></div>
      {state && !state.ok && <p className="rounded-[var(--radius-sm)] bg-danger-100 px-3 py-2 text-[13px] text-danger-500" role="alert">{state.error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>{pending ? <Loader2 width={16} height={16} className="animate-spin" /> : null} Войти</button>
      <p className="text-center text-[13px] text-ink-600">Нет аккаунта? <Link href={`/account/register${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="text-brand-500 underline">Зарегистрироваться</Link></p>
    </form>
  );
}

export function RegisterForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<ActionResult<undefined> | null, FormData>(registerAction, null);
  return (
    <form action={action} className="card mx-auto w-full max-w-md space-y-4 p-6" data-testid="register-form">
      <h1 className="h2">Регистрация</h1>
      {next && <input type="hidden" name="next" value={next} />}
      <div><label className="label" htmlFor="r-name">Имя</label><input id="r-name" name="firstName" className="input" required autoComplete="given-name" /></div>
      <div><label className="label" htmlFor="r-email">Email</label><input id="r-email" name="email" type="email" className="input" required autoComplete="email" /></div>
      <div><label className="label" htmlFor="r-phone">Телефон (необязательно)</label><input id="r-phone" name="phone" type="tel" className="input" autoComplete="tel" /></div>
      <div><label className="label" htmlFor="r-password">Пароль (не короче 8 символов)</label><input id="r-password" name="password" type="password" className="input" required minLength={8} autoComplete="new-password" /></div>
      {state && !state.ok && <p className="rounded-[var(--radius-sm)] bg-danger-100 px-3 py-2 text-[13px] text-danger-500" role="alert">{state.error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>{pending ? <Loader2 width={16} height={16} className="animate-spin" /> : null} Создать аккаунт</button>
      <p className="text-center text-[12px] text-ink-500">Регистрируясь, вы принимаете <Link href="/info/terms" className="underline">пользовательское соглашение</Link> и <Link href="/info/privacy" className="underline">политику конфиденциальности</Link>.</p>
      <p className="text-center text-[13px] text-ink-600">Уже есть аккаунт? <Link href="/account/login" className="text-brand-500 underline">Войти</Link></p>
    </form>
  );
}
