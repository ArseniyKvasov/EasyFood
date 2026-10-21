import { one, query } from '../db.js';
import { displayName, normalizeName } from '../lib/text.js';
import type { Nutrition, Product, Settings } from '../types.js';

export type ProductRow = {
  id: string;
  source: string;
  name: string;
  kcal: string;
  protein: string;
  fat: string;
  carbs: string;
  serving_g: string;
  barcode: string;
  use_count: string;
  user_id: string | null;
  brand: string | null;
  ext_id: string | null;
  ext_slug: string | null;
  norm_name: string | null;
};

export function mapProduct(r: ProductRow): Product {
  return {
    id: Number(r.id),
    source: (r.source as Product['source']) ?? 'own',
    // Продукт каталога принадлежит платформе, личный — пользователю.
    owner: r.user_id === null ? 'platform' : 'user',
    // Бренд показываем в скобках, если его нет в самом названии.
    name: displayName(r.name, r.brand ?? ''),
    brand: r.brand ?? '',
    kcal: Number(r.kcal),
    protein: Number(r.protein),
    fat: Number(r.fat),
    carbs: Number(r.carbs),
    servingG: Number(r.serving_g),
    barcode: r.barcode ?? '',
    useCount: Number(r.use_count),
    extId: r.ext_id ?? undefined,
    extSlug: r.ext_slug ?? undefined,
  };
}

export const PRODUCT_COLUMNS = `id, source, name, kcal, protein, fat, carbs, serving_g, barcode, use_count, user_id, brand, ext_id, ext_slug, norm_name`;

export async function getSettings(userId: number): Promise<Settings> {
  await query(`INSERT INTO settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  const r = await one<{
    kcal_target: number;
    protein_target: number;
    fat_target: number;
    carbs_target: number;
    theme: string;
    onboarded: boolean;
  }>(
    `SELECT kcal_target, protein_target, fat_target, carbs_target, theme, onboarded
       FROM settings WHERE user_id = $1`,
    [userId],
  );
  return {
    kcal: r?.kcal_target ?? 2100,
    protein: r?.protein_target ?? 95,
    fat: r?.fat_target ?? 65,
    carbs: r?.carbs_target ?? 210,
    theme: (r?.theme as Settings['theme']) ?? 'auto',
    onboarded: r?.onboarded ?? false,
  };
}

/** Кэширует продукт из Open Food Facts в общий каталог, чтобы не ходить в сеть повторно. */
export async function findOrCacheOffProduct(p: {
  name: string;
  brand?: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  servingG: number;
  barcode: string;
}): Promise<Product> {
  const existing = await one<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE barcode = $1 AND user_id IS NULL LIMIT 1`,
    [p.barcode],
  );
  if (existing) return mapProduct(existing);

  const brand = p.brand ?? '';
  const rows = await query<ProductRow>(
    `INSERT INTO products (source, name, brand, kcal, protein, fat, carbs, serving_g, barcode, norm_name, user_id)
     VALUES ('off', $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)
     RETURNING ${PRODUCT_COLUMNS}`,
    [p.name, brand, p.kcal, p.protein, p.fat, p.carbs, p.servingG, p.barcode, normalizeName(p.name)],
  );
  return mapProduct(rows[0]);
}

export function scale(n: Nutrition, grams: number): Nutrition {
  const k = grams / 100;
  return {
    kcal: n.kcal * k,
    protein: n.protein * k,
    fat: n.fat * k,
    carbs: n.carbs * k,
  };
}
