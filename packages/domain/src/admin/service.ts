import { getEnv } from '@techmatch/config';
import type { DbClient, PrismaClient } from '@techmatch/database';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../shared/errors';
import { hashPassword, sha256, verifyPassword } from '../shared/password';
import { randomToken } from '../shared/ids';
import { PERMISSIONS, ROLES, roleHasPermission, type Permission } from './rbac';
import { writeAudit } from '../audit/service';

export interface AdminContext {
  id: string;
  email: string;
  name: string;
  roleCode: string;
  roleName: string;
  permissions: string[];
  mfaEnabled: boolean;
}

export async function ensureRolesAndPermissions(db: DbClient) {
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { code }, create: { code, description }, update: { description } });
  }
  const all = await db.permission.findMany();
  for (const [code, role] of Object.entries(ROLES)) {
    const r = await db.role.upsert({ where: { code }, create: { code, name: role.name, description: role.description }, update: { name: role.name, description: role.description } });
    const wanted = role.permissions === '*' ? all : all.filter((p) => (role.permissions as string[]).includes(p.code));
    await db.rolePermission.deleteMany({ where: { roleId: r.id } });
    await db.rolePermission.createMany({ data: wanted.map((p) => ({ roleId: r.id, permissionId: p.id })), skipDuplicates: true });
  }
}

export async function loginAdmin(db: PrismaClient, input: { email: string; password: string; userAgent?: string; ip?: string }) {
  const email = input.email.trim().toLowerCase();
  const admin = await db.adminUser.findUnique({ where: { email }, include: { role: true } });
  if (!admin || !admin.isActive || !verifyPassword(input.password, admin.passwordHash)) {
    await writeAudit(db, { actorType: 'ADMIN', actorEmail: email, action: 'admin.login_failed', entityType: 'AdminUser', ip: input.ip });
    throw new UnauthorizedError('Неверный email или пароль');
  }
  // MFA: архитектурный резерв. Если включена — здесь проверяется TOTP-код (mfaSecretEncrypted).
  const token = randomToken(32);
  const ttlHours = getEnv().ADMIN_SESSION_TTL_HOURS;
  await db.adminSession.create({ data: { adminId: admin.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlHours * 3_600_000), userAgent: input.userAgent?.slice(0, 200) ?? null, ip: input.ip ?? null } });
  await db.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
  await writeAudit(db, { actorType: 'ADMIN', actorId: admin.id, actorEmail: admin.email, action: 'admin.login', entityType: 'AdminUser', entityId: admin.id, ip: input.ip });
  return { token, admin };
}

export async function resolveAdminSession(db: DbClient, token: string | undefined | null): Promise<AdminContext | null> {
  if (!token) return null;
  const session = await db.adminSession.findUnique({ where: { tokenHash: sha256(token) }, include: { admin: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
  if (!session || session.expiresAt < new Date() || !session.admin.isActive) return null;
  const a = session.admin;
  return { id: a.id, email: a.email, name: a.name, roleCode: a.role.code, roleName: a.role.name, permissions: a.role.permissions.map((p) => p.permission.code), mfaEnabled: a.mfaEnabled };
}

export async function logoutAdmin(db: DbClient, token: string | undefined | null) {
  if (!token) return;
  await db.adminSession.deleteMany({ where: { tokenHash: sha256(token) } });
}

export function hasPermission(ctx: AdminContext, needed: Permission): boolean {
  return roleHasPermission(ctx.roleCode, ctx.permissions, needed);
}

export function requirePermission(ctx: AdminContext | null, needed: Permission): AdminContext {
  if (!ctx) throw new UnauthorizedError('Требуется вход в панель администратора');
  if (!hasPermission(ctx, needed)) throw new ForbiddenError(`Нет права «${PERMISSIONS[needed]}»`);
  return ctx;
}

export async function listAdminUsers(db: DbClient) {
  return db.adminUser.findMany({ include: { role: true }, orderBy: { createdAt: 'asc' } });
}

export async function listRoles(db: DbClient) {
  return db.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } }, orderBy: { code: 'asc' } });
}

export async function createAdminUser(db: DbClient, actor: AdminContext, input: { email: string; name: string; password: string; roleCode: string }) {
  requirePermission(actor, 'users.write');
  if (input.roleCode === 'owner' && actor.roleCode !== 'owner') throw new ForbiddenError('Назначать владельца может только владелец');
  if (input.password.length < 10) throw new ValidationError('Пароль сотрудника — не короче 10 символов');
  const role = await db.role.findUnique({ where: { code: input.roleCode } });
  if (!role) throw new NotFoundError('Роль', input.roleCode);
  const email = input.email.trim().toLowerCase();
  if (await db.adminUser.findUnique({ where: { email } })) throw new ConflictError('Сотрудник с таким email уже есть');
  const user = await db.adminUser.create({ data: { email, name: input.name, passwordHash: hashPassword(input.password), roleId: role.id } });
  await writeAudit(db, { actorType: 'ADMIN', actorId: actor.id, actorEmail: actor.email, action: 'admin_user.create', entityType: 'AdminUser', entityId: user.id, after: { email, name: input.name, role: input.roleCode } });
  return user;
}

export async function updateAdminUser(db: DbClient, actor: AdminContext, id: string, input: { name?: string; roleCode?: string; isActive?: boolean; password?: string }) {
  requirePermission(actor, 'users.write');
  const user = await db.adminUser.findUnique({ where: { id }, include: { role: true } });
  if (!user) throw new NotFoundError('Сотрудник', id);
  if ((user.role.code === 'owner' || input.roleCode === 'owner') && actor.roleCode !== 'owner') throw new ForbiddenError('Изменять владельца может только владелец');
  if (id === actor.id && input.isActive === false) throw new ConflictError('Нельзя деактивировать себя');
  const data: Record<string, unknown> = {};
  if (input.name) data.name = input.name;
  if (typeof input.isActive === 'boolean') data.isActive = input.isActive;
  if (input.password) {
    if (input.password.length < 10) throw new ValidationError('Пароль сотрудника — не короче 10 символов');
    data.passwordHash = hashPassword(input.password);
  }
  if (input.roleCode) {
    const role = await db.role.findUnique({ where: { code: input.roleCode } });
    if (!role) throw new NotFoundError('Роль', input.roleCode);
    data.roleId = role.id;
  }
  const updated = await db.adminUser.update({ where: { id }, data });
  await writeAudit(db, { actorType: 'ADMIN', actorId: actor.id, actorEmail: actor.email, action: 'admin_user.update', entityType: 'AdminUser', entityId: id, before: { name: user.name, role: user.role.code, isActive: user.isActive }, after: { name: updated.name, role: input.roleCode ?? user.role.code, isActive: updated.isActive, passwordChanged: Boolean(input.password) } });
  return updated;
}
