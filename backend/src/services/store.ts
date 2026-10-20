import { one, query } from '../db.js';
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
};

export function mapProduct(r: ProductRow): Product {
  return {
    id: Number(r.id),
    source: (r.source as Product['source']) ?? 'own',
    name: r.name,
    kcal: Number(r.kcal),
    protein: Number(r.protein),
    fat: Number(r.fat),
    carbs: Number(r.carbs),
    servingG: Number(r.serving_g),
    barcode: r.barcode ?? '',
    useCount: Number(r.use_count),
  };
}

export const PRODUCT_COLUMNS = `id, source, name, kcal, protein, fat, carbs, serving_g, barcode, use_count`;

export async function getSettings(): Promise<Settings> {
  const r = await one<{
    kcal_target: number;
    protein_target: number;
    fat_target: number;
    carbs_target: number;
    theme: string;
    onboarded: boolean;
  }>(
    `SELECT kcal_target, protein_target, fat_target, carbs_target, theme, onboarded FROM settings WHERE id = 1`,
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

/** Кэширует продукт из Open Food Facts, чтобы не ходить в сеть повторно. */
export async function findOrCacheOffProduct(p: {
  name: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  servingG: number;
  barcode: string;
}): Promise<Product> {
  const existing = await one<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE barcode = $1 LIMIT 1`,
    [p.barcode],
  );
  if (existing) return mapProduct(existing);

  const rows = await query<ProductRow>(
    `INSERT INTO products (source, name, kcal, protein, fat, carbs, serving_g, barcode)
     VALUES ('off', $1, $2, $3, $4, $5, $6, $7)
     RETURNING ${PRODUCT_COLUMNS}`,
    [p.name, p.kcal, p.protein, p.fat, p.carbs, p.servingG, p.barcode],
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
