import { one, query } from '../db.js';
import { normalizeName } from '../lib/text.js';
import type { Product } from '../types.js';
import { mapProduct, PRODUCT_COLUMNS, type ProductRow } from './store.js';

/**
 * Порог похожести для триграмм. Ниже стандартного 0.3, чтобы ловить
 * словоформы: «овсянка» → «Овсяные хлопья» (0.28). Мусор при этом
 * не появляется — совпадения с низким баллом просто оказываются внизу.
 */
const SIMILARITY_THRESHOLD = 0.24;

/**
 * Поиск по своей базе. Триграммы Postgres позволяют находить продукт
 * даже с опечаткой: «гречк варёная» найдёт «Гречка варёная».
 */
export const searchLocal = async (q: string, limit = 30): Promise<Product[]> => {
  const norm = normalizeName(q);
  if (!norm) return [];
  // Совсем короткий запрос ищем только по совпадению строк: триграммы
  // на двух-трёх буквах дают лишние совпадения.
  const fuzzy = norm.length >= 3;

  const rows = await query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products
      WHERE norm_name LIKE $1 || '%'
         OR name ILIKE '%' || $2 || '%'
         OR ($5 AND similarity(norm_name, $3) > $4)
      ORDER BY CASE
                 WHEN norm_name = $3 THEN 0
                 WHEN norm_name LIKE $1 || '%' THEN 1
                 ELSE 2
               END,
               similarity(norm_name, $3) DESC,
               use_count DESC,
               lower(name)
      LIMIT $6`,
    [norm, q.trim(), norm, SIMILARITY_THRESHOLD, fuzzy, limit],
  );
  return rows.map(mapProduct);
};

/** Похожие названия из своей базы — ими чиним опечатки в запросе. */
export const suggestSimilar = async (q: string, threshold = 0.3): Promise<string[]> => {
  const norm = normalizeName(q);
  if (!norm) return [];
  const rows = await query<{ name: string; score: number }>(
    `SELECT name, similarity(norm_name, $1)::float8 AS score
       FROM products
      WHERE similarity(norm_name, $1) > $2
      ORDER BY score DESC
      LIMIT 3`,
    [norm, threshold],
  );
  return rows.map((r) => r.name);
};

export type CatalogProduct = {
  source: 'off' | 'np';
  name: string;
  brand?: string;
  barcode?: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  servingG?: number;
  extId?: string;
  extSlug?: string;
};

/**
 * Кладёт продукт в общий каталог. Повторный импорт того же продукта
 * обновляет КБЖУ, но не трогает счётчик использования.
 */
export const upsertCatalogProduct = async (p: CatalogProduct): Promise<Product> => {
  const norm = normalizeName(p.name);
  const brand = p.brand ?? '';
  const barcode = p.barcode ?? '';
  const serving = p.servingG && p.servingG > 0 ? p.servingG : 100;

  // Тот же продукт уже есть — обновляем КБЖУ.
  const existing = await one<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products
      WHERE user_id IS NULL
        AND ( ($1::text <> '' AND barcode = $1)
           OR ($2::text IS NOT NULL AND ext_id = $2)
           OR (norm_name = $3 AND lower(brand) = lower($4)) )
      LIMIT 1`,
    [barcode, p.extId ?? null, norm, brand],
  );

  if (existing) {
    const rows = await query<ProductRow>(
      `UPDATE products
          SET kcal = $2, protein = $3, fat = $4, carbs = $5,
              serving_g = $6, barcode = CASE WHEN $7::text <> '' THEN $7 ELSE barcode END,
              ext_id = COALESCE($8::text, ext_id), ext_slug = COALESCE($9::text, ext_slug),
              norm_name = $10
        WHERE id = $1
      RETURNING ${PRODUCT_COLUMNS}`,
      [
        existing.id,
        p.kcal,
        p.protein,
        p.fat,
        p.carbs,
        serving,
        barcode,
        p.extId ?? null,
        p.extSlug ?? null,
        norm,
      ],
    );
    return mapProduct(rows[0]);
  }

  const rows = await query<ProductRow>(
    `INSERT INTO products (source, name, brand, kcal, protein, fat, carbs, serving_g, barcode, ext_id, ext_slug, norm_name, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL)
     RETURNING ${PRODUCT_COLUMNS}`,
    [
      p.source,
      p.name,
      brand,
      p.kcal,
      p.protein,
      p.fat,
      p.carbs,
      serving,
      barcode,
      p.extId ?? null,
      p.extSlug ?? null,
      norm,
    ],
  );
  return mapProduct(rows[0]);
};

/** Есть ли уже такой продукт в каталоге. */
export const findByBarcode = async (barcode: string): Promise<Product | null> => {
  if (!barcode) return null;
  const row = await one<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE user_id IS NULL AND barcode = $1 LIMIT 1`,
    [barcode],
  );
  return row ? mapProduct(row) : null;
};

export const findByExtSlug = async (extSlug: string): Promise<Product | null> => {
  if (!extSlug) return null;
  const row = await one<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE ext_slug = $1 LIMIT 1`,
    [extSlug],
  );
  return row ? mapProduct(row) : null;
};

export const findByExtId = async (extId: string): Promise<Product | null> => {
  if (!extId) return null;
  const row = await one<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE ext_id = $1 LIMIT 1`,
    [extId],
  );
  return row ? mapProduct(row) : null;
};
