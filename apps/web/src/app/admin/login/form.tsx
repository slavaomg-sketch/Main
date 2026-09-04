'use client';

import { useActionState } from 'react';
import { Loader2 } from 'lucide-react';
import { adminLoginAction } from '@/server/actions/admin/auth';
import type { ActionResult } from '@/lib/errors';

export function AdminLoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<ActionResult<undefined> | null, FormData>(adminLoginAction, null);
  return (
    <form action={action} className="card space-y-4 p-6" data-testid="admin-login">
      {next && <input type="hidden" name="next" value={next} />}
      <div><label className="label" htmlFor="a-email">Email</label><input id="a-email" name="email" type="email" className="input" required autoComplete="username" /></div>
      <div><label className="label" htmlFor="a-password">Пароль</label><input id="a-password" name="password" type="password" className="input" required autoComplete="current-password" /></div>
      {state && !state.ok && <p className="rounded-[var(--radius-sm)] bg-danger-100 px-3 py-2 text-[13px] text-danger-500" role="alert">{state.error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>{pending ? <Loader2 width={16} height={16} className="animate-spin" /> : null} Войти</button>
    </form>
  );
}
