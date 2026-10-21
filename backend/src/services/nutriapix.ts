import { config } from '../config.js';
import { query } from '../db.js';
import { RateLimiter, sleep } from './limiter.js';

/** Продукт в ответе /food/search — без КБЖУ, только название, бренд и слаги. */
export type NutriapixSearchItem = {
  food_name: string;
  food_brand?: string;
  food_slug: string;
};

export type NutriapixServing = {
  serving_id?: string;
  serving_description?: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string;
  is_default?: boolean;
};

export type NutriapixFood = {
  food_id: string;
  food_name: string;
  food_type?: string;
  brand_id?: string;
  brand_name?: string;
  category?: string;
  slug?: string;
  nutritions: {
    calories?: number;
    protein?: { total_protein?: number };
    fat?: { total_fat?: number };
    carbohydrate?: { total_carbohydrate?: number };
  };
  servings?: NutriapixServing[];
};

export type NutriapixSearchResponse = {
  page?: number;
  pages?: number;
  total?: number;
  results?: NutriapixSearchItem[];
};

export type NutriapixHintsResponse = {
  hints?: unknown[];
};

// Лимиты тестового токена: 5 RPS у обычных методов, 20 RPS у подсказок.
const searchLimiter = new RateLimiter(5);
const hintsLimiter = new RateLimiter(20);
const foodLimiter = new RateLimiter(5);

export const nutriapixEnabled = () => config.nutriapix.apiKey.length > 0;

/** Текущий месяц в формате YYYY-MM. */
const currentMonth = (): string => new Date().toISOString().slice(0, 7);

/**
 * Списывает один запрос из месячного бюджета.
 * Возвращает false, если лимит исчерпан.
 */
export const takeBudget = async (provider: string, limit: number): Promise<boolean> => {
  if (limit <= 0) return false;
  const rows = await query<{ used: number }>(
    `INSERT INTO api_usage (provider, month, used) VALUES ($1, $2, 1)
     ON CONFLICT (provider, month)
     DO UPDATE SET used = api_usage.used + 1
      WHERE api_usage.used < $3
     RETURNING used`,
    [provider, currentMonth(), limit],
  );
  return rows.length > 0;
};

/** Сколько запросов в этом месяце уже потрачено. */
export const budgetUsed = async (provider: string): Promise<number> => {
  const rows = await query<{ used: number }>(
    `SELECT used FROM api_usage WHERE provider = $1 AND month = $2`,
    [provider, currentMonth()],
  );
  return rows[0]?.used ?? 0;
};

export class BudgetExceededError extends Error {
  constructor(provider: string) {
    super(`Бюджет ${provider} исчерпан`);
    this.name = 'BudgetExceededError';
  }
}

type RequestOptions = {
  limiter: RateLimiter;
  /** Запрос к /food тратит месячный бюджет. */
  provider?: string;
  budget?: number;
  signal?: AbortSignal;
};

const request = async <T>(path: string, params: Record<string, string | number>, opts: RequestOptions): Promise<T> => {
  const url = new URL(`${config.nutriapix.baseUrl}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  await opts.limiter.take();
  try {
    // Лимит месяца проверяем до запроса: исчерпан — не тратим и попытку.
    if (opts.provider && opts.budget !== undefined) {
      const ok = await takeBudget(opts.provider, opts.budget);
      if (!ok) throw new BudgetExceededError(opts.provider);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      try {
        const res = await fetch(url, {
          headers: {
            'NUTRIAPIX-API-KEY': config.nutriapix.apiKey,
            Accept: 'application/json',
          },
          redirect: 'follow',
          signal: ctrl.signal,
        });
        if (res.status === 404) throw Object.assign(new Error('NOT_FOUND'), { statusCode: 404 });
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`NUTRIAPIX_${res.status}`);
          await sleep(400 * (attempt + 1));
          continue;
        }
        if (!res.ok) {
          throw Object.assign(new Error(`NUTRIAPIX_${res.status}`), { statusCode: 502 });
        }
        return (await res.json()) as T;
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 404) throw err;
        lastError = err;
        if ((err as Error).name === 'AbortError') break;
        await sleep(300 * (attempt + 1));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('NUTRIAPIX_FAILED');
  } finally {
    opts.limiter.release();
  }
};

/** Поиск продуктов по названию. Месячного лимита не расходует. */
export const searchFood = async (
  q: string,
  page = 1,
  limit = 20,
): Promise<NutriapixSearchResponse> => {
  if (!nutriapixEnabled()) return { results: [] };
  try {
    const res = await request<NutriapixSearchResponse>(
      '/food/search',
      { q, page, limit },
      { limiter: searchLimiter },
    );
    return { ...res, results: res.results ?? [] };
  } catch (err) {
    console.warn('[nutriapix] search failed:', (err as Error).message);
    return { results: [] };
  }
};

/** Подсказки для подсказчика в поиске. */
export const searchHints = async (q: string, limit = 8): Promise<string[]> => {
  if (!nutriapixEnabled()) return [];
  try {
    const res = await request<NutriapixHintsResponse>(
      '/food/search/hints',
      { q, limit },
      { limiter: hintsLimiter },
    );
    return (res.hints ?? [])
      .map((h) => {
        if (typeof h === 'string') return h;
        const obj = h as { food_name?: string; name?: string; hint?: string };
        return obj.food_name ?? obj.name ?? obj.hint ?? '';
      })
      .filter(Boolean);
  } catch (err) {
    console.warn('[nutriapix] hints failed:', (err as Error).message);
    return [];
  }
};

/** Полная карточка продукта: КБЖУ, бренд, порции. Тратит месячный бюджет. */
export const getFood = async (
  by: { id?: string; slug?: string; barcode?: string },
  provider = 'nutriapix.food',
  budget = config.nutriapix.monthlyBudget - config.nutriapix.backfillBudget,
): Promise<NutriapixFood | null> => {
  if (!nutriapixEnabled()) return null;
  const params: Record<string, string> = {};
  if (by.id) params.id = by.id;
  if (by.slug) params.slug = by.slug;
  if (by.barcode) params.barcode = by.barcode;
  if (!Object.keys(params).length) return null;

  try {
    return await request<NutriapixFood>('/food', params, {
      limiter: foodLimiter,
      provider,
      budget: Math.max(0, budget),
    });
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    if ((err as { statusCode?: number }).statusCode === 404) return null;
    console.warn('[nutriapix] getFood failed:', (err as Error).message);
    return null;
  }
};
