import { prisma } from '@techmatch/database';
import { listAdminUsers, listRoles, PERMISSIONS } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { AdminPage, Table } from '@/components/admin/ui';
import { CreateUserForm, EditUserForm } from '@/components/admin/user-forms';
import { formatDateTime } from '@/lib/format';

export default async function AdminUsers() {
  const admin = await requireAdmin('users.read');
  const [users, roles] = await Promise.all([listAdminUsers(prisma), listRoles(prisma)]);
  const canWrite = admin.roleCode === 'owner' || admin.roleCode === 'admin' || admin.permissions.includes('users.write');
  return (
    <AdminPage title="Сотрудники и роли" description="RBAC: владелец, администратор, контент-менеджер, менеджер каталога, менеджер заказов, поддержка">
      {canWrite && <div className="mb-5"><CreateUserForm roles={roles.map((r) => ({ code: r.code, name: r.name }))} /></div>}
      <div className="space-y-3">
        {users.map((u) => canWrite ? <EditUserForm key={u.id} user={{ id: u.id, name: u.name, email: u.email, roleCode: u.role.code, isActive: u.isActive }} roles={roles.map((r) => ({ code: r.code, name: r.name }))} self={u.id === admin.id} /> : <div key={u.id} className="card p-3 text-[13px]">{u.name} · {u.email} · {u.role.name}{u.lastLoginAt ? ` · вход ${formatDateTime(u.lastLoginAt)}` : ''}</div>)}
      </div>
      <h2 className="mt-6 mb-2 text-[15px] font-bold">Роли и права</h2>
      <Table>
        <thead><tr><th>Роль</th><th>Сотрудников</th><th>Права</th></tr></thead>
        <tbody>{roles.map((r) => <tr key={r.id}><td className="font-semibold">{r.name}<div className="text-[12px] font-normal text-ink-500">{r.description}</div></td><td>{r._count.users}</td><td className="text-[12px] text-ink-600">{r.permissions.length === Object.keys(PERMISSIONS).length ? 'все права' : r.permissions.map((p) => p.permission.code).join(', ')}</td></tr>)}</tbody>
      </Table>
      <p className="mt-3 text-[12px] text-ink-500">MFA для администраторов: в модели AdminUser зарезервированы поля mfaEnabled / mfaSecretEncrypted, проверка TOTP подключается в loginAdmin (см. docs/KNOWN_LIMITATIONS.md).</p>
    </AdminPage>
  );
}
