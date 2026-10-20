import { config } from '../config.js';
import type { Nutrition, Product } from '../types.js';

const BASE = 'https://world.openfoodfacts.org';
const UA = 'EasyFood/1.0 (+https://github.com/easyfood)';

type OffNutriments = {
  'energy-kcal_100g'?: number;
  energy_100g?: number;
  proteins_100g?: number;
  fat_100g?: number;
  carbohydrates_100g?: number;
};

export type OffProduct = {
  code: string;
  name: string;
  brand: string;
  nutrition: Nutrition;
  servingG: number;
  imageUrl: string | null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** OFF хранит порцию как «30 g», «250 ml», «1 portion» — берём только граммы. */
function parseServing(value: unknown): number {
  if (typeof value === 'number' && value > 0) return value;
  if (typeof value !== 'string') return 100;
  const g = value.match(/(\d+(?:[.,]\d+)?)\s*g/i);
  if (g) return num(g[1].replace(',', '.')) || 100;
  const ml = value.match(/(\d+(?:[.,]\d+)?)\s*ml/i);
  if (ml) return num(ml[1].replace(',', '.')) || 100;
  return 100;
}

async function offFetch(path: string): Promise<unknown | null> {
  if (!config.openFoodFacts) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalize(p: Record<string, unknown>): OffProduct | null {
  const n = (p.nutriments ?? {}) as OffNutriments;
  const kcal = num(n['energy-kcal_100g'] ?? n.energy_100g);
  const code = String(p.code ?? '');
  const name = String(
    p.product_name_ru ?? p.product_name ?? (p.brands ? `${p.brands} (${p.code})` : ''),
  ).trim();
  if (!name || !code) return null;

  const imageUrl = typeof p.image_front_small_url === 'string' ? p.image_front_small_url : null;

  return {
    code,
    name,
    brand: String(p.brands ?? '').split(',')[0]?.trim() ?? '',
    nutrition: {
      kcal,
      protein: num(n.proteins_100g),
      fat: num(n.fat_100g),
      carbs: num(n.carbohydrates_100g),
    },
    servingG: parseServing(p.serving_size ?? p.serving_quantity),
    imageUrl,
  };
}

export async function lookupBarcode(code: string): Promise<OffProduct | null> {
  const clean = code.replace(/\D/g, '');
  if (clean.length < 8) return null;
  const data = await offFetch(`/api/v2/product/${clean}.json?fields=code,product_name,product_name_ru,brands,nutriments,serving_size,serving_quantity,image_front_small_url`);
  if (!data || typeof data !== 'object') return null;
  const status = (data as { status?: number }).status;
  const product = (data as { product?: Record<string, unknown> }).product;
  if (status !== 1 || !product) return null;
  return normalize(product);
}

export async function search(query: string, limit = 20): Promise<OffProduct[]> {
  const q = query.trim();
  if (!q) return [];
  const fields = 'code,product_name,product_name_ru,brands,nutriments,serving_size,serving_quantity,image_front_small_url';
  const params = new URLSearchParams({
    search_terms: q,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: String(limit),
    fields,
  });
  const data = await offFetch(`/cgi/search.pl?${params.toString()}`);
  if (!data || typeof data !== 'object') return [];
  const products = (data as { products?: Record<string, unknown>[] }).products ?? [];
  return products
    .map((p) => normalize(p))
    .filter((p): p is OffProduct => p !== null && p.nutrition.kcal > 0);
}

/** Приводит продукт OFF к нашей модели продукта. */
export function toProduct(p: OffProduct, id: number): Product {
  return {
    id,
    source: 'off',
    name: p.brand ? `${p.brand} — ${p.name}` : p.name,
    kcal: p.nutrition.kcal,
    protein: p.nutrition.protein,
    fat: p.nutrition.fat,
    carbs: p.nutrition.carbs,
    servingG: p.servingG || 100,
    barcode: p.code,
    useCount: 0,
  };
}
