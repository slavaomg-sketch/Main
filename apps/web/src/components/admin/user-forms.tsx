'use client';

import { ActionForm } from '@/components/admin/action-form';
import { Field } from '@/components/admin/ui';
import { createAdminUserAction, updateAdminUserAction } from '@/server/actions/admin/users';

export function CreateUserForm({ roles }: { roles: Array<{ code: string; name: string }> }) {
  return (
    <ActionForm action={createAdminUserAction} submitLabel="Создать сотрудника" className="card p-5">
      <h2 className="mb-3 text-[15px] font-bold">Новый сотрудник</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Имя"><input name="name" className="input min-h-9" required /></Field>
        <Field label="Email"><input name="email" type="email" className="input min-h-9" required /></Field>
        <Field label="Пароль (≥10 символов)"><input name="password" type="password" className="input min-h-9" required minLength={10} autoComplete="new-password" /></Field>
        <Field label="Роль"><select name="roleCode" className="input min-h-9" defaultValue="support">{roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></Field>
      </div>
    </ActionForm>
  );
}

export function EditUserForm({ user, roles, self }: { user: { id: string; name: string; email: string; roleCode: string; isActive: boolean }; roles: Array<{ code: string; name: string }>; self: boolean }) {
  return (
    <ActionForm action={updateAdminUserAction} submitLabel="Сохранить" variant="outline" className="rounded-[var(--radius-md)] border border-ink-200 p-3">
      <input type="hidden" name="id" value={user.id} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <Field label="Имя"><input name="name" className="input min-h-9" defaultValue={user.name} /></Field>
        <Field label="Email"><input className="input min-h-9" value={user.email} disabled /></Field>
        <Field label="Роль"><select name="roleCode" className="input min-h-9" defaultValue={user.roleCode}>{roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></Field>
        <Field label="Новый пароль"><input name="password" type="password" className="input min-h-9" autoComplete="new-password" placeholder="не менять" /></Field>
        <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" name="isActive" defaultChecked={user.isActive} disabled={self} className="size-4 accent-brand-500" /> активен</label>
      </div>
    </ActionForm>
  );
}
