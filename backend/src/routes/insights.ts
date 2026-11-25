
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db.js';
import { hasPlus } from '../services/billing.js';
import { getSettings } from '../services/store.js';

/**
 * Тренды и экспорт — функции Plus (см. оферту: «Все периоды, тренды», «CSV и PDF»).
 * Без Plus — 402 PLUS_REQUIRED, фронт открывает пейволл.
 */

async function requirePlus(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!req.user) {
    reply.code(401).send({ error: 'UNAUTHORIZED' });
    return false;
  }
  if (!(await hasPlus(req.user.id))) {
    reply.code(402).send({
      error: 'PLUS_REQUIRED',
      message: 'Тренды и экспорт доступны с подпиской Plus.',
    });
    return false;
  }
  return true;
}

const MEAL_NAMES: Record<string, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
};

const clampDays = (v: unknown, fallback: number, max: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(n)));
};

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

type DayRow = {
  day: string;
  entries: string;
  kcal: string | null;
  protein: string | null;
  fat: string | null;
  carbs: string | null;
};

export async function insightsRoutes(app: FastifyInstance): Promise<void> {
  /** Динамика КБЖУ по дням + сводка: средние, стрик, дни в норме. */
  app.get('/api/trends', async (req, reply) => {
    if (!(await requirePlus(req, reply))) return;
    const userId = req.user!.id;
    const days = clampDays((req.query as { days?: string }).days, 30, 365);
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86400000);
    const fromIso = isoDay(from);
    const toIso = isoDay(to);

    const rows = await query<DayRow>(
      'WITH days AS (SELECT generate_series($2::date, $3::date, ' + "'1 day'" + ')::date AS day) ' +
        'SELECT days.day::text AS day, COUNT(e.id)::text AS entries, ' +
        'ROUND(SUM(e.kcal100 * e.grams / 100))::text AS kcal, ' +
        'ROUND(SUM(e.protein100 * e.grams / 100), 1)::text AS protein, ' +
        'ROUND(SUM(e.fat100 * e.grams / 100), 1)::text AS fat, ' +
        'ROUND(SUM(e.carbs100 * e.grams / 100), 1)::text AS carbs ' +
        'FROM days LEFT JOIN entries e ON e.day = days.day AND e.user_id = $1 ' +
        'GROUP BY days.day ORDER BY days.day',
      [userId, fromIso, toIso],
    );
    const settings = await getSettings(userId);
    const num = (v: string | null): number => (v === null ? 0 : Number(v) || 0);
    const active = rows.filter(function (r) { return Number(r.entries) > 0; });
    const n = active.length || 1;
    const sum = function (f: (r: DayRow) => number): number {
      return active.reduce(function (s, r) { return s + f(r); }, 0);
    };
    const avg = function (v: number): number { return Math.round(v * 10) / 10; };
    // Стрик: подряд идущие дни с записями, считая от сегодня (или вчера, если сегодня пусто).
    let streak = 0;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (Number(rows[i].entries) > 0) streak += 1;
      else if (i === rows.length - 1) continue;
      else break;
    }
    const normLimit = settings.kcal * 1.1;
    const inNorm = active.filter(function (r) { return num(r.kcal) <= normLimit; }).length;
    return {
      from: fromIso,
      to: toIso,
      days: rows.map(function (r) {
        return {
          day: r.day,
          entries: Number(r.entries),
          kcal: num(r.kcal),
          protein: num(r.protein),
          fat: num(r.fat),
          carbs: num(r.carbs),
        };
      }),
      targets: { kcal: settings.kcal, protein: settings.protein, fat: settings.fat, carbs: settings.carbs },
      summary: {
        activeDays: active.length,
        totalDays: rows.length,
        avgKcal: Math.round(sum(function (r) { return num(r.kcal); }) / n),
        avgProtein: avg(sum(function (r) { return num(r.protein); }) / n),
        avgFat: avg(sum(function (r) { return num(r.fat); }) / n),
        avgCarbs: avg(sum(function (r) { return num(r.carbs); }) / n),
        streak: streak,
        inNormDays: inNorm,
        overDays: active.length - inNorm,
      },
    };
  });

  /** Записи за период — для печатной версии отчёта (PDF через печать). */
  app.get('/api/diary/range', async (req, reply) => {
    if (!(await requirePlus(req, reply))) return;
    const userId = req.user!.id;
    const from = String((req.query as { from?: string }).from || '');
    const to = String((req.query as { to?: string }).to || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Нужны даты from и to (YYYY-MM-DD)' });
    }
    const diff = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
    if (diff > 366) return reply.code(400).send({ error: 'VALIDATION', message: 'Период — не больше 366 дней' });
    const rows = await query<Record<string, unknown>>(
      'SELECT day::text AS day, meal, name, grams::text AS grams, ' +
        'ROUND(kcal100 * grams / 100)::text AS kcal, ROUND(protein100 * grams / 100, 1)::text AS protein, ' +
        'ROUND(fat100 * grams / 100, 1)::text AS fat, ROUND(carbs100 * grams / 100, 1)::text AS carbs ' +
        'FROM entries WHERE user_id = $1 AND day >= $2::date AND day <= $3::date ORDER BY day, id',
      [userId, from, to],
    );
    return { from: from, to: to, entries: rows };
  });

  /** Выгрузка дневника в CSV (Excel понимает точку с запятой и BOM). */
  app.get('/api/export.csv', async (req, reply) => {
    if (!(await requirePlus(req, reply))) return;
    const userId = req.user!.id;
    const toIso = isoDay(new Date());
    const fromDefault = isoDay(new Date(Date.now() - 89 * 86400000));
    const from = String((req.query as { from?: string }).from || fromDefault);
    const to = String((req.query as { to?: string }).to || toIso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Нужны даты from и to (YYYY-MM-DD)' });
    }
    const diff = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
    if (diff > 366) return reply.code(400).send({ error: 'VALIDATION', message: 'Период — не больше 366 дней' });
    const rows = await query<{ day: string; meal: string; name: string; grams: string; kcal: string; protein: string; fat: string; carbs: string }>(
      'SELECT day::text AS day, meal, name, grams::text AS grams, ' +
        'ROUND(kcal100 * grams / 100)::text AS kcal, ROUND(protein100 * grams / 100, 1)::text AS protein, ' +
        'ROUND(fat100 * grams / 100, 1)::text AS fat, ROUND(carbs100 * grams / 100, 1)::text AS carbs ' +
        'FROM entries WHERE user_id = $1 AND day >= $2::date AND day <= $3::date ORDER BY day, id',
      [userId, from, to],
    );
    const esc = function (v: string): string {
      return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const lines = ['Дата;Приём пищи;Продукт;Граммы;Ккал;Белки;Жиры;Углеводы'];
    for (const r of rows) {
      lines.push(
        [r.day, MEAL_NAMES[r.meal] || r.meal, esc(r.name), r.grams, r.kcal, r.protein, r.fat, r.carbs].join(';'),
      );
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="bitebalance-' + from + '-' + to + '.csv"');
    return '\uFEFF' + lines.join('\n');
  });
}
