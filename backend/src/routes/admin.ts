import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query } from '../db.js';
import { normalizeName } from '../lib/text.js';
import { requireAdmin, requireEditor, requireStaff } from '../middleware/admin.js';
import { revokeSubscription } from '../services/billing.js';
import { cancelPayment } from '../services/tbank.js';
import { tbankEnabled } from '../config.js';
async function audit(adminId: number, action: string, targetType: string, targetId: string, details: unknown): Promise<void> {
  try {
    await query('INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5)', [adminId, action, targetType, targetId, JSON.stringify(details ?? {})]);
  } catch { }
}
const daysAgo = (n: number): string => { const d = new Date(Date.now() - n * 86400000); return d.toISOString().slice(0, 10); };
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/me', { preHandler: requireStaff }, async (req) => {
    const m = await import('../middleware/admin.js');
    const st = await m.getAdminRole(req.user!.id);
    return { id: req.user!.id, login: req.user!.login, role: st.role };
  });
  app.get('/api/admin/overview', { preHandler: requireStaff }, async (req) => {
    const days = Math.min(90, Math.max(7, Number((req.query as { days?: string }).days ?? 30)));
    const since = daysAgo(days);
    const totals = await one<Record<string, string>>('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM users WHERE plan = $$plus$$) AS plus_users, (SELECT COUNT(*) FROM users WHERE is_blocked) AS blocked, (SELECT COUNT(*) FROM entries) AS entries, (SELECT COUNT(*) FROM entries WHERE day >= $1::date) AS entries_period, (SELECT COUNT(*) FROM products WHERE user_id IS NULL) AS catalog, (SELECT COUNT(*) FROM push_subscriptions) AS push_subs, (SELECT COUNT(*) FROM product_queries WHERE status = $$failed$$) AS failed_queries, (SELECT COUNT(*) FROM ai_requests WHERE created_at >= $1::date) AS ai_period', [since]);
    const regRows = await query<{ day: string; count: string }>('SELECT created_at::date::text AS day, COUNT(*)::text AS count FROM users WHERE created_at >= $1::date GROUP BY 1 ORDER BY 1', [since]);
    const entryRows = await query<{ day: string; count: string }>('SELECT day::text AS day, COUNT(*)::text AS count FROM entries WHERE day >= $1::date GROUP BY 1 ORDER BY 1', [since]);
    const activeRows = await query<{ day: string; count: string }>('SELECT day::text AS day, COUNT(DISTINCT user_id)::text AS count FROM entries WHERE day >= $1::date GROUP BY 1 ORDER BY 1', [since]);
    const aiRows = await query<{ day: string; count: string }>('SELECT created_at::date::text AS day, COUNT(*)::text AS count FROM ai_requests WHERE created_at >= $1::date GROUP BY 1 ORDER BY 1', [since]);
    const topProducts = await query<Record<string, unknown>>('SELECT id, name, brand, source, use_count, barcode FROM products WHERE user_id IS NULL ORDER BY use_count DESC LIMIT 10', []);
    const queueStats = await query<{ status: string; count: string }>('SELECT status, COUNT(*)::text AS count FROM product_queries GROUP BY status', []);
    const apiUsage = await query<Record<string, unknown>>('SELECT provider, month, used FROM api_usage ORDER BY month DESC LIMIT 24', []);
    return { totals, days, registrations: regRows, entries: entryRows, active: activeRows, ai: aiRows, topProducts, queueStats, apiUsage };
  });
  app.get('/api/admin/users', { preHandler: requireStaff }, async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').trim();
    const plan = String((req.query as { plan?: string }).plan ?? 'all');
    const blocked = String((req.query as { blocked?: string }).blocked ?? 'all');
    const limit = Math.min(100, Math.max(1, Number((req.query as { limit?: string }).limit ?? 30)));
    const offset = Math.max(0, Number((req.query as { offset?: string }).offset ?? 0));
    const conds: string[] = []; const params: unknown[] = [];
    if (q) { params.push('%' + q + '%'); conds.push('(login ILIKE $' + params.length + ' OR display_name ILIKE $' + params.length + ' OR email ILIKE $' + params.length + ')'); }
    if (plan === 'free' || plan === 'plus') { params.push(plan); conds.push('plan = $' + params.length); }
    if (blocked === 'yes') conds.push('is_blocked = TRUE');
    if (blocked === 'no') conds.push('is_blocked = FALSE');
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = await one<{ count: string }>('SELECT COUNT(*)::text AS count FROM users ' + where, params);
    const rows = await query<Record<string, unknown>>('SELECT id, login, display_name, email, role, plan, is_blocked, created_at::text AS created_at FROM users ' + where + ' ORDER BY id DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2), [...params, limit, offset]);
    return { total: Number(total?.count ?? 0), users: rows };
  });
  app.get('/api/admin/users/:id', { preHandler: requireStaff }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'BAD_ID' });
    const user = await one<Record<string, unknown>>('SELECT id, yandex_id, login, display_name, email, role, plan, plan_until::text AS plan_until, is_blocked, blocked_reason, note, created_at::text AS created_at FROM users WHERE id = $1', [id]);
    if (!user) return reply.code(404).send({ error: 'NOT_FOUND' });
    const settings = await one<Record<string, unknown>>('SELECT kcal_target, protein_target, fat_target, carbs_target, theme, onboarded FROM settings WHERE user_id = $1', [id]);
    const counts = await one<Record<string, string>>('SELECT (SELECT COUNT(*)::text FROM entries WHERE user_id = $1) AS entries, (SELECT COUNT(*)::text FROM products WHERE user_id = $1) AS own_products, (SELECT COUNT(*)::text FROM push_subscriptions WHERE user_id = $1) AS push, (SELECT COUNT(*)::text FROM ai_requests WHERE user_id = $1) AS ai, (SELECT COUNT(*)::text FROM sessions WHERE user_id = $1) AS sessions', [id]);
    const recentEntries = await query<Record<string, unknown>>('SELECT id, day::text AS day, meal, name, grams::text AS grams FROM entries WHERE user_id = $1 ORDER BY id DESC LIMIT 20', [id]);
    const recentAi = await query<Record<string, unknown>>('SELECT id, kind, success, latency_ms, created_at::text AS created_at FROM ai_requests WHERE user_id = $1 ORDER BY id DESC LIMIT 10', [id]);
    const lastDays = await query<{ day: string; count: string }>('SELECT day::text AS day, COUNT(*)::text AS count FROM entries WHERE user_id = $1 AND day > CURRENT_DATE - 14 GROUP BY 1 ORDER BY 1', [id]);
    return { user, settings, counts, recentEntries, recentAi, lastDays };
  });
  const userPatch = z.object({ role: z.enum(['user','analyst','support','content','admin','superadmin']).optional(), plan: z.enum(['free','plus']).optional(), plan_until: z.string().nullable().optional(), is_blocked: z.boolean().optional(), blocked_reason: z.string().max(300).optional(), note: z.string().max(1000).optional() });
  app.patch('/api/admin/users/:id', { preHandler: requireEditor }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'BAD_ID' });
    const body = userPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    const b = body.data;
    if (id === req.user!.id && b.is_blocked) return reply.code(400).send({ error: 'VALIDATION', message: 'Нельзя заблокировать самого себя' });
    await query('UPDATE users SET role = COALESCE($2, role), plan = COALESCE($3, plan), is_blocked = COALESCE($4, is_blocked), blocked_reason = COALESCE($5, blocked_reason), note = COALESCE($6, note), updated_at = now() WHERE id = $1', [id, b.role ?? null, b.plan ?? null, b.is_blocked ?? null, b.blocked_reason ?? null, b.note ?? null]);
    if (b.plan_until !== undefined && b.plan_until) { await query('UPDATE users SET plan_until = $2::timestamptz WHERE id = $1', [id, b.plan_until]); }
    if (b.plan_until === null) { await query('UPDATE users SET plan_until = NULL WHERE id = $1', [id]); }
    if (b.is_blocked) await query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await audit(req.user!.id, 'user.update', 'user', String(id), b);
    const row = await one('SELECT id, login, role, plan, is_blocked FROM users WHERE id = $1', [id]);
    return row;
  });
  app.delete('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'BAD_ID' });
    if (id === req.user!.id) return reply.code(400).send({ error: 'VALIDATION', message: 'Нельзя удалить самого себя' });
    const row = await one<{ login: string }>('SELECT login FROM users WHERE id = $1', [id]);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' });
    await query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await query('DELETE FROM users WHERE id = $1', [id]);
    await audit(req.user!.id, 'user.delete', 'user', String(id), { login: row.login });
    return { ok: true };
  });
  app.get('/api/admin/products', { preHandler: requireStaff }, async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').trim();
    const source = String((req.query as { source?: string }).source ?? 'all');
    const hidden = String((req.query as { hidden?: string }).hidden ?? 'all');
    const limit = Math.min(100, Math.max(1, Number((req.query as { limit?: string }).limit ?? 30)));
    const offset = Math.max(0, Number((req.query as { offset?: string }).offset ?? 0));
    const conds = ['(user_id IS NULL)']; const params: unknown[] = [];
    if (q) { params.push('%' + q + '%'); conds.push('(name ILIKE $' + params.length + ' OR brand ILIKE $' + params.length + ' OR barcode ILIKE $' + params.length + ')'); }
    if (source !== 'all') { params.push(source); conds.push('source = $' + params.length); }
    if (hidden === 'yes') conds.push('COALESCE(is_hidden, FALSE) = TRUE');
    if (hidden === 'no') conds.push('COALESCE(is_hidden, FALSE) = FALSE');
    const where = 'WHERE ' + conds.join(' AND ');
    const total = await one<{ count: string }>('SELECT COUNT(*)::text AS count FROM products ' + where, params);
    const rows = await query<Record<string, unknown>>('SELECT id, source, name, brand, kcal::text AS kcal, protein::text AS protein, fat::text AS fat, carbs::text AS carbs, barcode, use_count, COALESCE(is_hidden, FALSE) AS is_hidden FROM products ' + where + ' ORDER BY use_count DESC, id DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2), [...params, limit, offset]);
    return { total: Number(total?.count ?? 0), products: rows };
  });
  const productPatch = z.object({ name: z.string().trim().min(1).max(200).optional(), brand: z.string().trim().max(120).optional(), kcal: z.number().min(0).max(2000).optional(), protein: z.number().min(0).max(500).optional(), fat: z.number().min(0).max(500).optional(), carbs: z.number().min(0).max(500).optional(), servingG: z.number().positive().max(5000).optional(), barcode: z.string().trim().max(64).optional(), is_hidden: z.boolean().optional() });
  app.patch('/api/admin/products/:id', { preHandler: requireEditor }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'BAD_ID' });
    const body = productPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    const b = body.data;
    const norm = b.name ? normalizeName(b.name) : null;
    await query('UPDATE products SET name = COALESCE($2, name), brand = COALESCE($3, brand), kcal = COALESCE($4, kcal), protein = COALESCE($5, protein), fat = COALESCE($6, fat), carbs = COALESCE($7, carbs), serving_g = COALESCE($8, serving_g), barcode = COALESCE($9, barcode), is_hidden = COALESCE($10, is_hidden), norm_name = COALESCE($11, norm_name) WHERE id = $1 AND user_id IS NULL', [id, b.name ?? null, b.brand ?? null, b.kcal ?? null, b.protein ?? null, b.fat ?? null, b.carbs ?? null, b.servingG ?? null, b.barcode ?? null, b.is_hidden ?? null, norm]);
    await audit(req.user!.id, 'product.update', 'product', String(id), b);
    return { ok: true };
  });
  app.delete('/api/admin/products/:id', { preHandler: requireEditor }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'BAD_ID' });
    await query('DELETE FROM products WHERE id = $1 AND user_id IS NULL', [id]);
    await audit(req.user!.id, 'product.delete', 'product', String(id), {});
    return { ok: true };
  });
  app.get('/api/admin/queries', { preHandler: requireStaff }, async (req) => {
    const status = String((req.query as { status?: string }).status ?? 'all');
    const s = String((req.query as { q?: string }).q ?? '').trim();
    const limit = Math.min(100, Math.max(1, Number((req.query as { limit?: string }).limit ?? 30)));
    const offset = Math.max(0, Number((req.query as { offset?: string }).offset ?? 0));
    const conds: string[] = []; const params: unknown[] = [];
    if (status !== 'all') { params.push(status); conds.push('status = $' + params.length); }
    if (s) { params.push('%' + s + '%'); conds.push('(query ILIKE $' + params.length + ' OR raw_query ILIKE $' + params.length + ')'); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = await one<{ count: string }>('SELECT COUNT(*)::text AS count FROM product_queries ' + where, params);
    const rows = await query<Record<string, unknown>>('SELECT query, raw_query, hits, found, status, attempts, last_error, last_seen::text AS last_seen, next_try::text AS next_try FROM product_queries ' + where + ' ORDER BY hits DESC, last_seen DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2), [...params, limit, offset]);
    return { total: Number(total?.count ?? 0), queries: rows };
  });
  app.post('/api/admin/queries/retry', { preHandler: requireEditor }, async (req, reply) => {
    const body = z.object({ query: z.string().min(1).max(300) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION' });
    await query('UPDATE product_queries SET status = $$pending$$, attempts = 0, last_error = NULL, next_try = now() WHERE query = $1', [body.data.query]);
    await audit(req.user!.id, 'query.retry', 'query', body.data.query, {});
    return { ok: true };
  });
  app.get('/api/admin/settings', { preHandler: requireStaff }, async () => {
    const rows = await query<{ key: string; value: unknown }>('SELECT key, value FROM app_settings ORDER BY key', []);
    const out: Record<string, unknown> = {}; for (const r of rows) out[r.key] = r.value;
    return { settings: out };
  });
  app.put('/api/admin/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const body = z.object({ key: z.string(), value: z.unknown() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION' });
    const allowed = ['ai_free_monthly', 'ai_plus_daily', 'maintenance_mode', 'support_banner'];
    if (!allowed.includes(body.data.key)) return reply.code(400).send({ error: 'VALIDATION', message: 'Неизвестный ключ' });
    await query('INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3', [body.data.key, JSON.stringify(body.data.value), req.user!.id]);
    await audit(req.user!.id, 'settings.update', 'settings', body.data.key, body.data.value);
    return { ok: true };
  });

  // ---------- Платежи и подписки ----------
  app.get('/api/admin/payments', { preHandler: requireStaff }, async (req) => {
    const status = String((req.query as { status?: string }).status ?? 'all');
    const limit = Math.min(100, Math.max(1, Number((req.query as { limit?: string }).limit ?? 30)));
    const offset = Math.max(0, Number((req.query as { offset?: string }).offset ?? 0));
    const params: unknown[] = [];
    const where = status === 'all' ? '' : 'WHERE p.status = $1';
    if (status !== 'all') params.push(status);
    const total = await one<{ count: string }>('SELECT COUNT(*)::text AS count FROM payments p ' + where, params);
    const rows = await query<Record<string, unknown>>(
      'SELECT p.id, p.user_id::text AS user_id, u.login, p.order_id, p.payment_id, p.amount, p.plan, p.kind, p.status, p.paid_at::text AS paid_at, p.created_at::text AS created_at FROM payments p LEFT JOIN users u ON u.id = p.user_id ' + where + ' ORDER BY p.id DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2),
      params.concat([limit, offset]),
    );
    return { total: Number(total && total.count ? total.count : 0), payments: rows };
  });
  app.get('/api/admin/payments/summary', { preHandler: requireStaff }, async () => {
    const byStatus = await query<{ status: string; count: string; total: string }>(
      "SELECT status, COUNT(*)::text AS count, COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount ELSE 0 END), 0)::text AS total FROM payments GROUP BY status",
      [],
    );
    const perMonth = await query<{ month: string; total: string; count: string }>(
      "SELECT to_char(paid_at, 'YYYY-MM') AS month, SUM(amount)::text AS total, COUNT(*)::text AS count FROM payments WHERE status = 'confirmed' AND paid_at > now() - interval '6 months' GROUP BY 1 ORDER BY 1 DESC",
      [],
    );
    return { byStatus: byStatus, perMonth: perMonth };
  });
  app.post('/api/admin/payments/:id/refund', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'BAD_ID' });
    const payment = await one<{ id: string; user_id: string; payment_id: string | null; status: string; kind: string; amount: string }>(
      'SELECT id::text AS id, user_id::text AS user_id, payment_id, status, kind, amount::text AS amount FROM payments WHERE id = $1',
      [id],
    );
    if (!payment) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (payment.status !== 'confirmed') return reply.code(409).send({ error: 'BAD_STATE', message: 'Возврат возможен только для подтверждённого платежа' });
    if (!tbankEnabled()) return reply.code(503).send({ error: 'BILLING_DISABLED', message: 'Т-Банк не настроен' });
    if (!payment.payment_id) return reply.code(409).send({ error: 'BAD_STATE', message: 'Нет PaymentId банка' });
    try {
      await cancelPayment(payment.payment_id);
    } catch (err) {
      return reply.code(502).send({ error: 'REFUND_FAILED', message: 'Банк отклонил возврат: ' + (err as Error).message });
    }
    await query("UPDATE payments SET status = 'refunded' WHERE id = $1", [id]);
    let revoked = false;
    if (payment.kind === 'initial') {
      await revokeSubscription(Number(payment.user_id));
      revoked = true;
    }
    await audit(req.user!.id, 'payment.refund', 'payment', String(id), { amount: payment.amount, revoked: revoked });
    return { ok: true, revoked: revoked };
  });
  app.get('/api/admin/subscriptions', { preHandler: requireStaff }, async (req) => {
    const limit = Math.min(100, Math.max(1, Number((req.query as { limit?: string }).limit ?? 30)));
    const offset = Math.max(0, Number((req.query as { offset?: string }).offset ?? 0));
    const rows = await query<Record<string, unknown>>(
      'SELECT s.user_id::text AS user_id, u.login, s.plan, s.status, s.current_end::text AS current_end, s.cancel_at::text AS cancel_at, s.rebill_id IS NOT NULL AS has_rebill FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.current_end DESC LIMIT $1 OFFSET $2',
      [limit, offset],
    );
    const total = await one<{ count: string }>('SELECT COUNT(*)::text AS count FROM subscriptions', []);
    return { total: Number(total && total.count ? total.count : 0), subscriptions: rows };
  });
  app.post('/api/admin/subscriptions/cancel', { preHandler: requireEditor }, async (req, reply) => {
    const body = z.object({ userId: z.number().int() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION' });
    await query("UPDATE subscriptions SET cancel_at = COALESCE(cancel_at, now()), updated_at = now() WHERE user_id = $1", [body.data.userId]);
    await audit(req.user!.id, 'subscription.cancel', 'subscription', String(body.data.userId), {});
    return { ok: true };
  });
  app.get('/api/admin/ai-usage', { preHandler: requireStaff }, async (req) => {
    const days = Math.min(90, Math.max(7, Number((req.query as { days?: string }).days ?? 30)));
    const since = daysAgo(days);
    const perDay = await query<Record<string, unknown>>('SELECT created_at::date::text AS day, COUNT(*)::text AS total FROM ai_requests WHERE created_at >= $1::date GROUP BY 1 ORDER BY 1', [since]);
    const top = await query<Record<string, unknown>>('SELECT u.id, u.login, COUNT(*)::text AS total FROM ai_requests r JOIN users u ON u.id = r.user_id WHERE r.created_at >= $1::date GROUP BY u.id, u.login ORDER BY COUNT(*) DESC LIMIT 15', [since]);
    return { days, perDay, top };
  });
  app.get('/api/admin/audit', { preHandler: requireStaff }, async (req) => {
    const limit = Math.min(100, Math.max(1, Number((req.query as { limit?: string }).limit ?? 30)));
    const offset = Math.max(0, Number((req.query as { offset?: string }).offset ?? 0));
    const rows = await query<Record<string, unknown>>('SELECT l.id, l.action, l.target_type, l.target_id, l.details, l.created_at::text AS created_at, u.login AS admin_login FROM admin_audit_log l LEFT JOIN users u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT $1 OFFSET $2', [limit, offset]);
    const total = await one<{ count: string }>('SELECT COUNT(*)::text AS count FROM admin_audit_log', []);
    return { total: Number(total?.count ?? 0), log: rows };
  });
}