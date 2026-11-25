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
 * Поиск по своей базе: личные продукты пользователя и общий каталог.
 * Триграммы Postgres позволяют находить продукт даже с опечаткой:
 * «гречк варёная» найдёт «Гречка варёная». Штрихкод ищется точным
 * совпадением — так в поле поиска можно ввести цифры.
 */
export const searchLocal = async (q: string, userId: number, limit = 30): Promise<Product[]> => {
  const norm = normalizeName(q);
  if (!norm) return [];
  // Совсем короткий запрос ищем только по совпадению строк: триграммы
  // на двух-трёх буквах дают лишние совпадения.
  const fuzzy = norm.length >= 3;

  const rows = await query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products
      WHERE COALESCE(is_hidden, FALSE) = FALSE AND (user_id IS NULL OR user_id = $2)
        AND (
          norm_name LIKE $1 || '%'
          OR name ILIKE '%' || $3 || '%'
          OR barcode = $3
          OR ($6 AND similarity(norm_name, $4) > $5)
        )
      ORDER BY CASE WHEN user_id = $2 THEN 0 ELSE 1 END,
               CASE
                 WHEN barcode = $3 THEN 0
                 WHEN norm_name = $4 THEN 1
                 WHEN norm_name LIKE $1 || '%' THEN 2
                 ELSE 3
               END,
               similarity(norm_name, $4) DESC,
               use_count DESC,
               lower(name)
      LIMIT $7`,
    [norm, userId, q.trim(), norm, SIMILARITY_THRESHOLD, fuzzy, limit],
  );
  return rows.map(mapProduct);
};

export type CatalogProduct = {
  source: 'off' | 'perek' | 'np';
  name: string;
  brand?: string;
  barcode?: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  servingG?: number;
  extId?: string;
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
          SET source = $9, kcal = $2, protein = $3, fat = $4, carbs = $5,
              serving_g = $6, barcode = CASE WHEN $7::text <> '' THEN $7 ELSE barcode END,
              ext_id = COALESCE($8::text, ext_id),
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
        p.source,
        norm,
      ],
    );
    return mapProduct(rows[0]);
  }

  try {
    const rows = await query<ProductRow>(
      `INSERT INTO products (source, name, brand, kcal, protein, fat, carbs, serving_g, barcode, ext_id, norm_name, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL)
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
        norm,
      ],
    );
    return mapProduct(rows[0]);
  } catch (err) {
    // Параллельный запрос успел вставить тот же внешний продукт.
    if (p.extId && (err as { code?: string }).code === '23505') {
      const row = await one<ProductRow>(
        `SELECT ${PRODUCT_COLUMNS} FROM products WHERE ext_id = $1 LIMIT 1`,
        [p.extId],
      );
      if (row) return mapProduct(row);
    }
    throw err;
  }
};
