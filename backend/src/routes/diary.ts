import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query } from '../db.js';
import { MEALS, type Entry, type MealId, type Nutrition } from '../types.js';
import { getSettings } from '../services/store.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const dateSchema = z.string().regex(DATE_RE, 'Некорректная дата (YYYY-MM-DD)');

const entryRow = z.object({
  day: dateSchema,
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  productId: z.number().int().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  grams: z.number().positive().max(5000),
  nutrition: z.object({
    kcal: z.number().min(0).max(1000),
    protein: z.number().min(0).max(100),
    fat: z.number().min(0).max(100),
    carbs: z.number().min(0).max(100),
  }),
});

type EntryRow = {
  id: string;
  day: string;
  meal: MealId;
  product_id: string | null;
  name: string;
  grams: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  kcal100: number;
  protein100: number;
  fat100: number;
  carbs100: number;
};

function mapEntry(r: EntryRow): Entry {
  return {
    id: Number(r.id),
    day: r.day,
    meal: r.meal,
    productId: r.product_id === null ? null : Number(r.product_id),
    name: r.name,
    grams: Number(r.grams),
    nutrition: { kcal: r.kcal, protein: r.protein, fat: r.fat, carbs: r.carbs },
    per100: { kcal: r.kcal100, protein: r.protein100, fat: r.fat100, carbs: r.carbs100 },
  };
}

const ENTRY_SELECT = `
  id, day, meal, product_id, name, grams,
  ROUND(kcal100 * grams / 100)::float8    AS kcal,
  ROUND(protein100 * grams / 100)::float8 AS protein,
  ROUND(fat100 * grams / 100)::float8     AS fat,
  ROUND(carbs100 * grams / 100)::float8   AS carbs,
  kcal100::float8 AS kcal100,
  protein100::float8 AS protein100,
  fat100::float8 AS fat100,
  carbs100::float8 AS carbs100`;

/**
 * Запоминает, с каким весом пользователь добавил продукт — чтобы в следующий раз
 * предложить этот вес готовым вариантом.
 */
async function rememberPortion(userId: number, productId: number | null, grams: number): Promise<void> {
  if (!productId) return;
  await query(
    `INSERT INTO product_portions (user_id, product_id, grams, uses, updated_at)
     VALUES ($1, $2, $3, 1, now())
     ON CONFLICT (user_id, product_id, grams)
     DO UPDATE SET uses = product_portions.uses + 1, updated_at = now()`,
    [userId, productId, grams],
  );
  // Не даём таблице расти бесконечно: оставляем 20 самых частых весов.
  await query(
    `DELETE FROM product_portions
      WHERE user_id = $1 AND product_id = $2
        AND grams NOT IN (
          SELECT grams FROM product_portions
           WHERE user_id = $1 AND product_id = $2
           ORDER BY uses DESC, updated_at DESC LIMIT 20
        )`,
    [userId, productId],
  );
}

export async function diaryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/diary', async (req) => {
    const parsed = dateSchema.safeParse((req.query as { date?: string }).date ?? '');
    const date = parsed.success ? parsed.data : new Date().toISOString().slice(0, 10);

    const userId = req.user!.id;
    const rows = await query<EntryRow>(
      `SELECT ${ENTRY_SELECT} FROM entries WHERE day = $1 AND user_id = $2 ORDER BY id`,
      [date, userId],
    );
    const settings = await getSettings(userId);

    const entries = rows.map(mapEntry);
    const totals: Nutrition = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    for (const e of entries) {
      totals.kcal += e.nutrition.kcal;
      totals.protein += e.nutrition.protein;
      totals.fat += e.nutrition.fat;
      totals.carbs += e.nutrition.carbs;
    }
    totals.kcal = Math.round(totals.kcal);
    totals.protein = Math.round(totals.protein * 10) / 10;
    totals.fat = Math.round(totals.fat * 10) / 10;
    totals.carbs = Math.round(totals.carbs * 10) / 10;

    const meals = MEALS.map((m) => {
      const list = entries.filter((e) => e.meal === m.id);
      const kcal = Math.round(list.reduce((s, e) => s + e.nutrition.kcal, 0));
      return { id: m.id, name: m.name, emoji: m.emoji, kcal, entries: list };
    });

    return { date, settings, totals, meals };
  });

  app.post('/api/entries', async (req, reply) => {
    const body = entryRow.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    }
    const { day, meal, productId, name, grams, nutrition } = body.data;

    const userId = req.user!.id;
    const rows = await query<{ id: string }>(
      `INSERT INTO entries (day, meal, product_id, name, grams, kcal100, protein100, fat100, carbs100, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [day, meal, productId ?? null, name, grams, nutrition.kcal, nutrition.protein, nutrition.fat, nutrition.carbs, userId],
    );
    if (productId) {
      await query(`UPDATE products SET use_count = use_count + 1 WHERE id = $1`, [productId]);
    }
    await rememberPortion(userId, productId ?? null, grams);
    return reply.code(201).send({ id: Number(rows[0].id) });
  });

  app.patch('/api/entries/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'BAD_ID' });

    const body = z
      .object({ grams: z.number().positive().max(5000).optional(), name: z.string().trim().min(1).max(200).optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });

    const current = await one<EntryRow>(
      `SELECT ${ENTRY_SELECT} FROM entries WHERE id = $1 AND user_id = $2`,
      [id, req.user!.id],
    );
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND' });

    const grams = body.data.grams ?? Number(current.grams);
    const name = body.data.name ?? current.name;

    await query(`UPDATE entries SET grams = $1, name = $2 WHERE id = $3 AND user_id = $4`, [
      grams,
      name,
      id,
      req.user!.id,
    ]);
    await rememberPortion(
      req.user!.id,
      current.product_id === null ? null : Number(current.product_id),
      grams,
    );
    return { id, grams, name };
  });

  app.delete('/api/entries/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const removed = await one<{ id: string }>(
      `DELETE FROM entries WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.user!.id],
    );
    if (!removed) return reply.code(404).send({ error: 'NOT_FOUND' });
    return { ok: true };
  });
}
