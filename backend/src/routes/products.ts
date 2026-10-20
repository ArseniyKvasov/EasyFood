import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query } from '../db.js';
import { lookupBarcode, search } from '../services/off.js';
import { findOrCacheOffProduct, mapProduct, PRODUCT_COLUMNS, type ProductRow } from '../services/store.js';

const productBody = z.object({
  name: z.string().trim().min(1).max(200),
  kcal: z.number().min(0).max(1000),
  protein: z.number().min(0).max(100),
  fat: z.number().min(0).max(100),
  carbs: z.number().min(0).max(100),
  servingG: z.number().positive().max(3000).default(100),
  barcode: z.string().trim().max(64).default(''),
  source: z.enum(['own', 'ai']).default('own'),
});

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/products', async (req) => {
    const q = ((req.query as { q?: string }).q ?? '').trim();
    const limit = Math.min(100, Number((req.query as { limit?: string }).limit ?? 50));
    const rows = await query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
       WHERE ($1 = '' OR lower(name) LIKE '%' || lower($1) || '%')
       ORDER BY use_count DESC, lower(name) ASC
       LIMIT $2`,
      [q, limit],
    );
    return { products: rows.map(mapProduct) };
  });

  app.get('/api/products/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = await one<ProductRow>(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1`, [id]);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' });
    return mapProduct(row);
  });

  app.post('/api/products', async (req, reply) => {
    const body = productBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    }
    const p = body.data;
    const rows = await query<ProductRow>(
      `INSERT INTO products (source, name, kcal, protein, fat, carbs, serving_g, barcode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${PRODUCT_COLUMNS}`,
      [p.source, p.name, p.kcal, p.protein, p.fat, p.carbs, p.servingG, p.barcode],
    );
    return reply.code(201).send(mapProduct(rows[0]));
  });

  app.patch('/api/products/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = productBody.partial().safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    }
    const current = await one<ProductRow>(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1`, [id]);
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND' });

    const p = { ...mapProduct(current), ...body.data };
    const rows = await query<ProductRow>(
      `UPDATE products SET source = $1, name = $2, kcal = $3, protein = $4, fat = $5, carbs = $6,
        serving_g = $7, barcode = $8 WHERE id = $9 RETURNING ${PRODUCT_COLUMNS}`,
      [p.source, p.name, p.kcal, p.protein, p.fat, p.carbs, p.servingG, p.barcode, id],
    );
    return mapProduct(rows[0]);
  });

  app.delete('/api/products/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const removed = await one<{ id: string }>(`DELETE FROM products WHERE id = $1 RETURNING id`, [id]);
    if (!removed) return reply.code(404).send({ error: 'NOT_FOUND' });
    return { ok: true };
  });

  /** Штрихкод: сначала локальный кэш, затем Open Food Facts. */
  app.get('/api/products/barcode/:code', async (req, reply) => {
    const code = String((req.params as { code: string }).code).replace(/\D/g, '');
    if (code.length < 8) return reply.code(400).send({ error: 'BAD_BARCODE' });

    const local = await one<ProductRow>(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE barcode = $1 LIMIT 1`, [code]);
    if (local) return { product: mapProduct(local), origin: 'local' };

    const off = await lookupBarcode(code);
    if (!off) return reply.code(404).send({ error: 'NOT_FOUND' });

    const product = await findOrCacheOffProduct({
      name: off.name,
      kcal: off.nutrition.kcal,
      protein: off.nutrition.protein,
      fat: off.nutrition.fat,
      carbs: off.nutrition.carbs,
      servingG: off.servingG,
      barcode: off.code,
    });
    return { product, origin: 'openfoodfacts' };
  });

  /** Поиск в Open Food Facts — используется, когда в базе ничего не нашлось. */
  app.get('/api/products/remote', async (req, reply) => {
    const q = String((req.query as { q?: string }).q ?? '').trim();
    if (!q) return { products: [] };
    const found = await search(q, 20);
    if (!found.length) return { products: [] };
    const products = await Promise.all(
      found.map((p) =>
        findOrCacheOffProduct({
          name: p.brand ? `${p.brand} — ${p.name}` : p.name,
          kcal: p.nutrition.kcal,
          protein: p.nutrition.protein,
          fat: p.nutrition.fat,
          carbs: p.nutrition.carbs,
          servingG: p.servingG,
          barcode: p.code,
        }),
      ),
    );
    return reply.send({ products });
  });
}
