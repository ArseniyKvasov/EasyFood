import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query } from '../db.js';
import { lookupBarcode, search } from '../services/off.js';
import { findOrCacheOffProduct, mapProduct, PRODUCT_COLUMNS, type ProductRow } from '../services/store.js';
import {
  findByBarcode,
  findByExtId,
  findByExtSlug,
  searchLocal,
  suggestSimilar,
  upsertCatalogProduct,
} from '../services/catalog.js';
import { displayName, normalizeName } from '../lib/text.js';
import {
  BudgetExceededError,
  getFood,
  nutriapixEnabled,
  searchFood,
  searchHints,
  type NutriapixFood,
} from '../services/nutriapix.js';
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

/** Продукт из внешнего каталога, у которого ещё нет КБЖУ. */
const pendingProduct = (name: string, brand: string, slug: string): Product => ({
  id: 0,
  source: 'np',
  owner: 'platform',
  name: displayName(name, brand),
  brand,
  kcal: 0,
  protein: 0,
  fat: 0,
  carbs: 0,
  servingG: 100,
  barcode: '',
  useCount: 0,
  extSlug: slug,
  pending: true,
});

/** Ключ для склейки одинаковых продуктов из разных источников. */
const dedupKey = (name: string, brand: string): string => {
  const suffix = brand ? ` (${brand})` : '';
  const raw = name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
  return normalizeName(raw);
};

/** КБЖУ и порция из карточки Nutriapix. */
const fromNutriapixFood = (food: NutriapixFood) => {
  const serving = (food.servings ?? []).find((s) => s.is_default) ?? food.servings?.[0];
  const amount = Number(serving?.metric_serving_amount ?? 0);
  const grams = amount > 0 ? amount : 100;
  return {
    name: food.food_name,
    brand: food.brand_name ?? '',
    barcode: '',
    kcal: Math.round((food.nutritions?.calories ?? 0) * 10) / 10,
    protein: Math.round((food.nutritions?.protein?.total_protein ?? 0) * 10) / 10,
    fat: Math.round((food.nutritions?.fat?.total_fat ?? 0) * 10) / 10,
    carbs: Math.round((food.nutritions?.carbohydrate?.total_carbohydrate ?? 0) * 10) / 10,
    servingG: grams,
    extId: food.food_id,
    extSlug: food.slug,
  };
};


export async function productRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Единый поиск: своя база (мгновенно, с опечатками) + Nutriapix
   * + Open Food Facts. Nutriapix отдаёт только названия, КБЖУ
   * подтягиваются при выборе продукта.
   */
  app.get('/api/products/search', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').trim();
    if (q.length < 2) return { products: [] };

    const local = await searchLocal(q, 30);
    const seen = new Set(local.map((p) => dedupKey(p.name, p.brand)));
    const products: Product[] = [...local];

    if (nutriapixEnabled()) {
      let res = await searchFood(q, 1, 20);
      // Пусто — пробуем похожее название из своей базы: так чиним опечатку.
      if (!res.results?.length) {
        const similar = await suggestSimilar(q);
        for (const name of similar) {
          res = await searchFood(name, 1, 10);
          if (res.results?.length) break;
        }
      }
      for (const item of res.results ?? []) {
        const key = dedupKey(item.food_name, item.food_brand ?? '');
        if (seen.has(key)) continue;
        seen.add(key);
        products.push(pendingProduct(item.food_name, item.food_brand ?? '', item.food_slug));
      }
    }

    // Open Food Facts отвечает медленно, поэтому его поиск идёт отдельным
    // запросом — фронтенд догружает результаты, не блокируя ввод.
    return { products, more: products.length < 10 && config.openFoodFacts };
  });

  /** Подсказки для поиска: свои из базы + подсказки Nutriapix. */
  app.get('/api/products/hints', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').trim();
    if (q.length < 2) return { hints: [] };

    const hints: string[] = [];
    const seen = new Set<string>();
    const local = await searchLocal(q, 6);
    for (const p of local) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      hints.push(p.name);
    }
    if (nutriapixEnabled()) {
      for (const h of await searchHints(q, 6)) {
        if (!h || seen.has(h)) continue;
        seen.add(h);
        hints.push(h);
      }
    }
    return { hints: hints.slice(0, 8) };
  });

  /**
   * Подтягивает КБЖУ из Nutriapix и кладёт продукт в общий каталог.
   * Тратит один запрос из месячного бюджета.
   */
  app.get('/api/products/external/nutriapix/:slug', async (req, reply) => {
    if (!nutriapixEnabled()) {
      return reply.code(501).send({ error: 'NUTRIAPIX_NOT_CONFIGURED' });
    }
    const slug = String((req.params as { slug: string }).slug ?? '').trim();
    if (!slug) return reply.code(400).send({ error: 'VALIDATION' });

    // Уже скачан — отдаём из базы, не тратя запрос из лимита.
    const known = await findByExtSlug(slug);
    if (known) return { product: known };

    try {
      const food = await getFood({ slug });
      if (!food) return reply.code(404).send({ error: 'NOT_FOUND' });
      const data = fromNutriapixFood(food);
      const product = await upsertCatalogProduct({ source: 'np', ...data });
      return { product };
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        return reply.code(429).send({
          error: 'BUDGET_EXCEEDED',
          message: 'Каталог временно недоступен.',
        });
      }
      throw err;
    }
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
   * Штрихкод: своя база → Nutriapix → Open Food Facts.
   * Внешний источник сразу кладёт продукт в каталог, чтобы повторные
   * обращения не тратили лимиты.
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

    if (nutriapixEnabled()) {
      try {
        const food = await getFood({ barcode: code });
        if (food) {
          const data = fromNutriapixFood(food);
          const product = await upsertCatalogProduct({
            source: 'np',
            ...data,
            barcode: code,
          });
          return { product, origin: 'nutriapix' };
        }
      } catch (err) {
        if (!(err instanceof BudgetExceededError)) {
          console.warn('[nutriapix] barcode lookup failed:', (err as Error).message);
        }
      }
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

  /** Поиск в Open Food Facts — используется, когда в базе ничего не нашлось. */
  app.get('/api/products/remote', async (req, reply) => {
    const q = String((req.query as { q?: string }).q ?? '').trim();
    if (!q) return { products: [] };
    const found = await search(q, 20);
    if (!found.length) return { products: [] };
    const products = await Promise.all(
      found.map((p) =>
        findOrCacheOffProduct({
          name: p.name,
          brand: p.brand,
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
