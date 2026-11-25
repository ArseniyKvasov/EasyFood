import type { FastifyReply, FastifyRequest } from 'fastify';
import { isBootstrapAdmin } from '../config.js';
import { one } from '../db.js';

export type AdminRole = 'user' | 'analyst' | 'support' | 'content' | 'admin' | 'superadmin';

type AdminRow = {
  id: string;
  login: string;
  role: string;
  is_blocked: boolean;
  plan: string;
};

const STAFF = new Set(['analyst', 'support', 'content', 'admin', 'superadmin']);

export async function getAdminRole(userId: number): Promise<{ role: AdminRole; login: string; isBlocked: boolean }> {
  const row = await one<AdminRow>('SELECT id, login, role, is_blocked FROM users WHERE id = $1', [userId]);
  if (!row) return { role: 'user', login: '', isBlocked: true };
  let role = (row.role as AdminRole) || 'user';
  if (role === 'user' && isBootstrapAdmin(row.login)) {
    await one('UPDATE users SET role = ' + "'superadmin'" + ' WHERE id = $1 RETURNING id', [userId]).catch(() => null);
    role = 'superadmin';
  }
  return { role, login: row.login, isBlocked: row.is_blocked };
}

export const isStaff = (role: AdminRole): boolean => STAFF.has(role);

export async function requireStaff(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user) { reply.code(401).send({ error: 'UNAUTHORIZED' }); return; }
  const st = await getAdminRole(req.user.id);
  if (st.isBlocked) { reply.code(403).send({ error: 'BLOCKED', message: 'Аккаунт заблокирован' }); return; }
  if (!isStaff(st.role)) { reply.code(403).send({ error: 'FORBIDDEN', message: 'Нужны права администратора' }); return; }
  (req as unknown as { adminRole?: AdminRole }).adminRole = st.role;
}

export async function requireEditor(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user) { reply.code(401).send({ error: 'UNAUTHORIZED' }); return; }
  const st = await getAdminRole(req.user.id);
  if (st.isBlocked) { reply.code(403).send({ error: 'BLOCKED', message: 'Аккаунт заблокирован' }); return; }
  if (st.role === 'user' || st.role === 'analyst') { reply.code(403).send({ error: 'FORBIDDEN', message: 'Нет прав на изменение' }); return; }
  (req as unknown as { adminRole?: AdminRole }).adminRole = st.role;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user) { reply.code(401).send({ error: 'UNAUTHORIZED' }); return; }
  const st = await getAdminRole(req.user.id);
  if (st.isBlocked) { reply.code(403).send({ error: 'BLOCKED', message: 'Аккаунт заблокирован' }); return; }
  if (st.role !== 'admin' && st.role !== 'superadmin') { reply.code(403).send({ error: 'FORBIDDEN', message: 'Нужна роль admin' }); return; }
  (req as unknown as { adminRole?: AdminRole }).adminRole = st.role;
}

export const adminRoleOf = (req: FastifyRequest): AdminRole | undefined =>
  (req as unknown as { adminRole?: AdminRole }).adminRole;
