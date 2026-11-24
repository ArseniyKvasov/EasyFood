import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { perekEnabled } from '../config.js';
import { one, query } from '../db.js';
import { lookupBarcode } from '../services/off.js';
import { findOrCacheOffProduct, mapProduct, PRODUCT_COLUMNS, type ProductRow } from '../services/store.js';
import { searchLocal, upsertCatalogProduct } from '../services/catalog.js';
import { lookupBarcodePerek, searchPerek, suggestPerek, toProductData, type PerekFood } from '../services/perek.js';
import {
  getQueryState,
  markQueryEnriched,
  markQueryFailed,
  queryNeedsEnrichment,
  touchQuery,
} from '../services/sync.js';
import { normalizeName } from '../lib/text.js';
import type { Product } from '../types.js';

const productBody = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(120).default(''),
  kcal: z.number().min(0).max(1000),
  protein: z.number().min(0).max(100),
  fat: z.number().min(0).max(100),
  carbs: z.number().min(0).max(100),
  servingG: z.number().positive().max(3000).default(100),
  barcode: z.string().trim().max(64).default(''),
  source: z.enum(['own', 'ai']).default('own'),
});

/** Ключ для склейки одинаковых продуктов из разных источников. */
const dedupKey = (name: string, brand: string): string => {
  const suffix = brand ? ` (${brand})` : '';
  const raw = name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
  return normalizeName(raw);
};

/** Продукт Perek сразу кладём в общий каталог: так работают порции и история. */
const cachePerekProduct = async (food: PerekFood, barcode = ''): Promise<Product | null> => {
  const data = toProductData(food, barcode);
  if (!data) return null;
  return upsertCatalogProduct({ source: 'perek', ...data });
};

/** В поле поиска можно ввести штрихкод — 8–14 цифр, как в Perek. */
const isBarcodeQuery = (q: string): boolean => /^\d{8,14}$/.test(q);


export async function productRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Единый поиск по названию или штрихкоду:
   *   1. своя база — личные продукты пользователя и общий каталог;
   *   2. Perek — только для нового или устаревшего запроса (см. sync.ts);
   *   3. для штрихкода, которого нет в Perek, — резервный Open Food Facts.
   *
   * Названия Open Food Facts больше не ищем: он остаётся только резервом
   * для штрихкодов.
   */
  app.get('/api/products/search', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').trim();
    if (q.length < 2) return { products: [] };

    const userId = req.user!.id;
    const local = await searchLocal(q, userId, 30);
    const seen = new Set(local.map((p) => dedupKey(p.name, p.brand)));
    const products: Product[] = [...local];

    const addPerek = async (food: PerekFood, barcode = ''): Promise<void> => {
      const key = dedupKey(food.name, food.brand?.name ?? '');
      if (seen.has(key)) return;
      seen.add(key);
      const product = await cachePerekProduct(food, barcode);
      if (product) products.push(product);
    };

    if (isBarcodeQuery(q)) {
      // В поле поиска ввели штрихкод: показываем только точное совпадение,
      // а не размытые совпадения по цифрам в названиях.
      const localHit = local.find((p) => p.barcode === q);
      if (localHit) return { products: [localHit] };

      const perek = await searchPerek(q, 5);
      const food = perek.foods[0];
      if (food) {
        const product = await cachePerekProduct(food, q);
        return { products: product ? [product] : [] };
      }

      // Perek не знает код — последний резерв, Open Food Facts.
      const off = await lookupBarcode(q);
      if (!off) return { products: [] };
      const product = await findOrCacheOffProduct({
        name: off.name,
        brand: off.brand,
        kcal: off.nutrition.kcal,
        protein: off.nutrition.protein,
        fat: off.nutrition.fat,
        carbs: off.nutrition.carbs,
        servingG: off.servingG,
        barcode: off.code,
      });
      return { products: [product] };
    }

    // Обогащаем каждый уникальный запрос один раз. Повторные поиски
    // обслуживаются локальной базой и не зависят от доступности Perek.
    const state = await touchQuery(q);
    if (perekEnabled() && state && queryNeedsEnrichment(state)) {
      const res = await searchPerek(q, 20);
      if (res.ok) {
        for (const food of res.foods) {
          await addPerek(food);
        }
        await markQueryEnriched(state.query, res.foods.length);
      } else {
        await markQueryFailed(state.query, 'Perek request failed');
      }
    }

    return { products };
  });

  /** Подсказки для поиска: свои из базы + Perek. */
  app.get('/api/products/hints', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').trim();
    if (q.length < 2) return { hints: [] };

    const hints: string[] = [];
    const seen = new Set<string>();
    const local = await searchLocal(q, req.user!.id, 6);
    for (const p of local) {
      const key = normalizeName(p.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      hints.push(p.name);
    }
    // Perek-подсказки нужны только пока запрос ещё не обогащён.
    // Если он уже в базе (или только что пусто), лишний запрос не делаем.
    const state = await getQueryState(q);
    const askPerek = hints.length < 8 && (!state || queryNeedsEnrichment(state));
    if (askPerek) {
      for (const h of await suggestPerek(q, 6)) {
        const key = normalizeName(h);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        hints.push(h);
      }
    }
    return { hints: hints.slice(0, 8) };
  });

  app.get('/api/products', async (req) => {
    const userId = req.user!.id;
    const q = ((req.query as { q?: string }).q ?? '').trim();
    const limit = Math.min(100, Number((req.query as { limit?: string }).limit ?? 50));
    // Сначала то, что пользователь добавлял сам (по числу своих порций),
    // потом общезаказные хиты каталога.
    const rows = await query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
       WHERE (user_id IS NULL OR user_id = $1)
         AND ($2 = '' OR lower(name) LIKE '%' || lower($2) || '%')
       ORDER BY (SELECT COALESCE(SUM(uses), 0) FROM product_portions
                  WHERE product_id = products.id AND user_id = $1) DESC,
                use_count DESC,
                lower(name) ASC
       LIMIT $3`,
      [userId, q, limit],
    );
    return { products: rows.map(mapProduct) };
  });

  app.get('/api/products/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = await one<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
        WHERE id = $1 AND (user_id IS NULL OR user_id = $2)`,
      [id, req.user!.id],
    );
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' });
    return mapProduct(row);
  });

  /** Привычные порции пользователя для этого продукта — по убыванию частоты. */
  app.get('/api/products/:id/portions', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'BAD_ID' });

    const product = await one<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
        WHERE id = $1 AND (user_id IS NULL OR user_id = $2)`,
      [id, req.user!.id],
    );
    if (!product) return reply.code(404).send({ error: 'NOT_FOUND' });

    const rows = await query<{ grams: string; uses: string }>(
      `SELECT grams, uses FROM product_portions
        WHERE user_id = $1 AND product_id = $2
        ORDER BY uses DESC, updated_at DESC
        LIMIT 10`,
      [req.user!.id, id],
    );
    return {
      portions: rows.map((r) => ({ grams: Number(r.grams), uses: Number(r.uses) })),
    };
  });

  app.post('/api/products', async (req, reply) => {
    const body = productBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    }
    const p = body.data;
    const rows = await query<ProductRow>(
      `INSERT INTO products (source, name, brand, kcal, protein, fat, carbs, serving_g, barcode, norm_name, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${PRODUCT_COLUMNS}`,
      [
        p.source,
        p.name,
        p.brand,
        p.kcal,
        p.protein,
        p.fat,
        p.carbs,
        p.servingG,
        p.barcode,
        normalizeName(p.name),
        req.user!.id,
      ],
    );
    return reply.code(201).send(mapProduct(rows[0]));
  });

  /**
   * Правка продукта. Каталог платформы — общий и неизменяемый: правке
   * поддаются только личные продукты пользователя.
   */
  app.patch('/api/products/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const userId = req.user!.id;
    const body = productBody.partial().safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    }
    const current = await one<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (!current) {
      // Каталог платформы виден всем, но не редактируется.
      const platform = await one<ProductRow>(
        `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1 AND user_id IS NULL`,
        [id],
      );
      if (platform) {
        return reply.code(403).send({
          error: 'PLATFORM_PRODUCT',
          message: 'Продукт из каталога нельзя изменить. Создайте свой.',
        });
      }
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }

    const p = { ...mapProduct(current), ...body.data };
    const values = [
      p.source === 'ai' ? 'ai' : 'own',
      p.name,
      p.brand ?? '',
      p.kcal,
      p.protein,
      p.fat,
      p.carbs,
      p.servingG,
      p.barcode,
      normalizeName(p.name),
    ];

    const rows = await query<ProductRow>(
      `UPDATE products SET source = $1, name = $2, brand = $3, kcal = $4, protein = $5, fat = $6, carbs = $7,
         serving_g = $8, barcode = $9, norm_name = $10
       WHERE id = $11 AND user_id = $12 RETURNING ${PRODUCT_COLUMNS}`,
      [...values, id, userId],
    );
    return mapProduct(rows[0]);
  });

  app.delete('/api/products/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const removed = await one<{ id: string }>(
      `DELETE FROM products WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.user!.id],
    );
    if (!removed) return reply.code(404).send({ error: 'NOT_FOUND' });
    return { ok: true };
  });

  /**
   * Штрихкод: своя база → Perek → Open Food Facts.
   * Perek сразу кладёт продукт в каталог, чтобы повторные обращения
   * не тратили лимит запросов.
   */
  app.get('/api/products/barcode/:code', async (req, reply) => {
    const userId = req.user!.id;
    const code = String((req.params as { code: string }).code).replace(/\D/g, '');
    if (code.length < 8) return reply.code(400).send({ error: 'BAD_BARCODE' });

    const local = await one<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products
        WHERE barcode = $1 AND (user_id IS NULL OR user_id = $2)
        ORDER BY user_id NULLS LAST LIMIT 1`,
      [code, userId],
    );
    if (local) return { product: mapProduct(local), origin: 'local' };

    const perek = await lookupBarcodePerek(code);
    if (perek) {
      const product = await cachePerekProduct(perek, code);
      if (product) return { product, origin: 'perek' };
    }

    const off = await lookupBarcode(code);
    if (!off) return reply.code(404).send({ error: 'NOT_FOUND' });

    const product = await findOrCacheOffProduct({
      name: off.name,
      brand: off.brand,
      kcal: off.nutrition.kcal,
      protein: off.nutrition.protein,
      fat: off.nutrition.fat,
      carbs: off.nutrition.carbs,
      servingG: off.servingG,
      barcode: off.code,
    });
    return { product, origin: 'openfoodfacts' };
  });
}
