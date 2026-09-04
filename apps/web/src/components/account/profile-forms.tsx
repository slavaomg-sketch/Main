'use client';

import { useActionState } from 'react';
import { changePasswordAction, updateProfileAction } from '@/server/actions/account';
import type { ActionResult } from '@/lib/errors';

type S = ActionResult<{ message: string }> | null;

export function ProfileForm({ customer }: { customer: { email: string; firstName: string | null; lastName: string | null; phone: string | null; marketingOptIn: boolean } }) {
  const [state, action, pending] = useActionState<S, FormData>(updateProfileAction, null);
  return (
    <form action={action} className="card space-y-4 p-5">
      <h2 className="h3">Данные профиля</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><label className="label">Email</label><input className="input" value={customer.email} disabled /></div>
        <div><label className="label" htmlFor="p-phone">Телефон</label><input id="p-phone" name="phone" className="input" defaultValue={customer.phone ?? ''} /></div>
        <div><label className="label" htmlFor="p-first">Имя</label><input id="p-first" name="firstName" className="input" defaultValue={customer.firstName ?? ''} /></div>
        <div><label className="label" htmlFor="p-last">Фамилия</label><input id="p-last" name="lastName" className="input" defaultValue={customer.lastName ?? ''} /></div>
      </div>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="marketingOptIn" defaultChecked={customer.marketingOptIn} className="size-4 accent-brand-500" /> Получать новости и акции</label>
      {state && <p className={`text-[13px] ${state.ok ? 'text-success-500' : 'text-danger-500'}`}>{state.ok ? state.data.message : state.error}</p>}
      <button type="submit" className="btn btn-primary" disabled={pending}>Сохранить</button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<S, FormData>(changePasswordAction, null);
  return (
    <form action={action} className="card space-y-4 p-5">
      <h2 className="h3">Смена пароля</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="pw-cur">Текущий пароль</label><input id="pw-cur" name="current" type="password" className="input" required autoComplete="current-password" /></div>
        <div><label className="label" htmlFor="pw-next">Новый пароль</label><input id="pw-next" name="next" type="password" className="input" required minLength={8} autoComplete="new-password" /></div>
      </div>
      {state && <p className={`text-[13px] ${state.ok ? 'text-success-500' : 'text-danger-500'}`}>{state.ok ? state.data.message : state.error}</p>}
      <button type="submit" className="btn btn-outline" disabled={pending}>Изменить пароль</button>
    </form>
  );
}
