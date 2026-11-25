
import type { FastifyInstance } from 'fastify';
import { one, query } from '../db.js';
import { requireStaff } from '../middleware/admin.js';

/**
 * Воронка продукта по образцу FastClassPrivate/analytics/user_funnel.py.
 *
 * Когорта — аккаунты, созданные в периоде (не поток событий).
 * Шаги последовательные: каждый следующий — подмножество предыдущего,
 * поэтому проценты вниз по воронке никогда не растут.
 * Plus — независимый коммерческий шаг (покупают до всякой активности),
 * считается по всей когорте, как paid-шаг в FastClass.
 * Счётчики опций фасеточные: каждый список игнорирует свой фильтр.
 */

const STAFF_ROLES = ['admin', 'superadmin', 'support', 'content', 'analyst'];

type FunnelFilters = {
  plan: string[];
  ai: string[];
  push: string[];
  from: string;
  to: string;
  staff: boolean;
};

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

const splitList = (v: unknown): string[] => {
  const out: string[] = [];
  for (const item of String(v ?? '').split(',')) {
    const s = item.trim();
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  return out;
};

const parseFilters = (q: Record<string, unknown>): FunnelFilters => {
  const okDate = (v: unknown): string | null => {
    const s = String(v ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  const today = new Date();
  const toD = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const fromD = new Date(toD.getTime() - 29 * 86400000);
  const from = okDate(q.from) || isoDate(fromD);
  const rawTo = okDate(q.to) || isoDate(toD);
  const staffRaw = String(q.staff ?? '').trim().toLowerCase();
  return {
    plan: splitList(q.plan).filter(function (v) { return v === 'free' || v === 'plus'; }),
    ai: splitList(q.ai).filter(function (v) { return v === 'yes' || v === 'no'; }),
    push: splitList(q.push).filter(function (v) { return v === 'yes' || v === 'no'; }),
    from: from <= rawTo ? from : rawTo,
    to: from <= rawTo ? rawTo : from,
    staff: staffRaw === '1' || staffRaw === 'true' || staffRaw === 'on' || staffRaw === 'yes',
  };
};

/** Когорта с флагами; skip — размерность, чей фильтр не применяем (фасетка). */
const cohortSql = (f: FunnelFilters, skip: string): { text: string; params: unknown[] } => {
  const conds: string[] = ['u.created_at::date >= $1::date', 'u.created_at::date <= $2::date'];
  const params: unknown[] = [f.from, f.to];
  if (!f.staff) {
    params.push(STAFF_ROLES);
    conds.push('COALESCE(u.role, ' + "'user'" + ') <> ALL ($' + params.length + ')');
  }
  if (f.plan.length && skip !== 'plan') {
    params.push(f.plan);
    conds.push('u.plan = ANY ($' + params.length + ')');
  }
  if (f.ai.length && skip !== 'ai') {
    if (f.ai.indexOf('yes') >= 0 && f.ai.indexOf('no') < 0) conds.push('EXISTS (SELECT 1 FROM ai_requests r WHERE r.user_id = u.id AND r.success)');
    if (f.ai.indexOf('no') >= 0 && f.ai.indexOf('yes') < 0) conds.push('NOT EXISTS (SELECT 1 FROM ai_requests r WHERE r.user_id = u.id AND r.success)');
  }
  if (f.push.length && skip !== 'push') {
    if (f.push.indexOf('yes') >= 0 && f.push.indexOf('no') < 0) conds.push('EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)');
    if (f.push.indexOf('no') >= 0 && f.push.indexOf('yes') < 0) conds.push('NOT EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)');
  }
  const text = 'SELECT u.id, u.plan, ' +
    'EXISTS (SELECT 1 FROM ai_requests r WHERE r.user_id = u.id AND r.success) AS has_ai, ' +
    'EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id) AS has_push ' +
    'FROM users u WHERE ' + conds.join(' AND ');
  return { text: text, params: params };
};

const rate = (part: number, whole: number): number | null => {
  if (!whole) return null;
  return Math.round((part * 1000) / whole) / 10;
};

export async function funnelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/funnel', { preHandler: requireStaff }, async (req) => {
    const f = parseFilters((req.query ?? {}) as Record<string, unknown>);
    const c = cohortSql(f, '');
    const agg = await one<Record<string, string>>(
      'WITH cohort AS (' + c.text + '), ' +
      'days AS (SELECT user_id, COUNT(DISTINCT day) AS d FROM entries WHERE user_id IN (SELECT id FROM cohort) GROUP BY user_id) ' +
      'SELECT (SELECT COUNT(*)::text FROM cohort) AS total, ' +
      '(SELECT COUNT(*)::text FROM cohort c JOIN days e ON e.user_id = c.id) AS first_entry, ' +
      '(SELECT COUNT(*)::text FROM cohort c JOIN days e ON e.user_id = c.id AND e.d >= 2) AS second_day, ' +
      '(SELECT COUNT(*)::text FROM cohort c JOIN days e ON e.user_id = c.id AND e.d >= 7) AS active_week, ' +
      '(SELECT COUNT(*)::text FROM cohort c WHERE c.plan = ' + "'plus'" + ') AS plus, ' +
      '(SELECT COUNT(*)::text FROM cohort c WHERE c.has_ai) AS ai_used, ' +
      '(SELECT COUNT(*)::text FROM cohort c WHERE c.has_push) AS push_on',
      c.params,
    );
    const num = (v: string | null | undefined): number => Number(v ?? 0) || 0;
    const total = num(agg && agg.total);
    const first = num(agg && agg.first_entry);
    const second = num(agg && agg.second_day);
    const week = num(agg && agg.active_week);
    const plus = num(agg && agg.plus);
    const aiUsed = num(agg && agg.ai_used);
    const pushOn = num(agg && agg.push_on);

    const cp = cohortSql(f, 'plan');
    const planRows = await query<{ key: string; count: string }>(
      'WITH cohort AS (' + cp.text + ') SELECT plan AS key, COUNT(*)::text AS count FROM cohort GROUP BY plan', cp.params,
    );
    const ca = cohortSql(f, 'ai');
    const aiRows = await query<{ key: boolean; count: string }>(
      'WITH cohort AS (' + ca.text + ') SELECT has_ai AS key, COUNT(*)::text AS count FROM cohort GROUP BY has_ai', ca.params,
    );
    const cs = cohortSql(f, 'push');
    const pushRows = await query<{ key: boolean; count: string }>(
      'WITH cohort AS (' + cs.text + ') SELECT has_push AS key, COUNT(*)::text AS count FROM cohort GROUP BY has_push', cs.params,
    );
    const planCount = (k: string): number => num((planRows.find(function (r) { return r.key === k; }) || {} as { count?: string }).count);
    const aiCount = (k: boolean): number => num((aiRows.find(function (r) { return String(r.key) === String(k); }) || {} as { count?: string }).count);
    const pushCount = (k: boolean): number => num((pushRows.find(function (r) { return String(r.key) === String(k); }) || {} as { count?: string }).count);

    return {
      filters: { plan: f.plan, ai: f.ai, push: f.push, staff: f.staff },
      period: { from: f.from, to: f.to },
      summary: {
        total: total,
        plus: plus, plus_share: rate(plus, total),
        ai_used: aiUsed, ai_share: rate(aiUsed, total),
        push_on: pushOn, push_share: rate(pushOn, total),
      },
      funnel: {
        total: total,
        steps: [
          { key: 'registered', label: 'Регистрация', count: total, rate_prev: null, rate_first: null, independent: false },
          { key: 'first_entry', label: 'Первая запись', count: first, rate_prev: rate(first, total), rate_first: rate(first, total), independent: false },
          { key: 'second_day', label: 'Второй день', count: second, rate_prev: rate(second, first), rate_first: rate(second, total), independent: false },
          { key: 'active_week', label: 'Неделя в дневнике', count: week, rate_prev: rate(week, second), rate_first: rate(week, total), independent: false },
          { key: 'plus', label: 'Plus', count: plus, rate_prev: null, rate_first: rate(plus, total), independent: true },
        ],
      },
      options: {
        plan: [
          { key: 'free', label: 'Free', count: planCount('free') },
          { key: 'plus', label: 'Plus', count: planCount('plus') },
        ],
        ai: [
          { key: 'yes', label: 'Использовали ИИ', count: aiCount(true) },
          { key: 'no', label: 'Без ИИ', count: aiCount(false) },
        ],
        push: [
          { key: 'yes', label: 'Push включён', count: pushCount(true) },
          { key: 'no', label: 'Push выключен', count: pushCount(false) },
        ],
      },
    };
  });
}
