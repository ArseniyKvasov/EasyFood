import { config, perekEnabled } from '../config.js';
import { PerMinuteLimiter, sleep } from './limiter.js';

/**
 * Клиент Perek (https://perek.us) — основного справочника российских
 * продуктов и КБЖУ. Ключ передаётся только с сервера в заголовке X-Api-Key.
 *
 * Документация: https://perek.us/llms-full.txt
 */

export type PerekBrand = {
  id?: string;
  name?: string;
  kind?: string;
};

export type PerekServing = {
  label?: string;
  grams?: number;
};

export type PerekPer100 = {
  kcal?: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  [key: string]: unknown;
};

/** Карточка продукта в ответе Perek (короткая или полная). */
export type PerekFood = {
  id: string | null;
  name: string;
  type?: string;
  brand?: PerekBrand | null;
  unit?: string;
  per100?: PerekPer100;
  servings?: PerekServing[];
  barcodes?: string[];
  url?: string;
};

type PerekSearchResponse = {
  foods?: PerekFood[];
  similar?: boolean;
  more?: boolean;
  barcode?: boolean;
};

type PerekSuggestResponse = {
  foods?: { id?: string; name?: string; brand?: PerekBrand | null }[];
};

type PerekBarcodeResponse = {
  food?: PerekFood;
};

/**
 * Лимит бесплатного тарифа — 20 запросов в минуту. Держим чуть ниже,
 * чтобы несколько параллельных пользователей не упирались в 429.
 */
const limiter = new PerMinuteLimiter(
  Math.max(1, Math.floor(config.perek.requestsPerMinute)),
  4,
);

const SEARCH_TTL_MS = 5 * 60_000;
const EMPTY_TTL_MS = 60_000;
const BARCODE_TTL_MS = 10 * 60_000;
const CACHE_LIMIT = 200;

type CacheEntry = { at: number; ttl: number; value: unknown };

const cache = new Map<string, CacheEntry>();

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > hit.ttl) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown, ttl: number): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.at > v.ttl) cache.delete(k);
  }
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: now, ttl, value });
}

type FetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; body: unknown };

/**
 * Запрос к Perek с таймаутом, повтором после 429/5xx и ограничением
 * частоты. Ошибки не бросаем: источник внешний, поиск должен продолжать
 * работать на своей базе.
 */
async function fetchJson<T>(path: string): Promise<FetchResult<T>> {
  if (!perekEnabled()) return { ok: false, status: 401, body: null };
  const url = `${config.perek.baseUrl}${path}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    await limiter.take();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, {
        headers: {
          'X-Api-Key': config.perek.apiKey,
          Accept: 'application/json',
        },
        signal: ctrl.signal,
      });

      if (res.status === 404) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          /* тело ошибки не JSON — нам важен только код */
        }
        return { ok: false, status: 404, body };
      }

      if (res.status === 429) {
        lastError = new Error('PEREK_429');
        if (attempt === 0) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const waitMs = Math.min(
            5000,
            Math.max(500, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1) * 1000),
          );
          await sleep(waitMs);
          continue;
        }
        return { ok: false, status: 429, body: null };
      }

      if (!res.ok) {
        lastError = new Error(`PEREK_${res.status}`);
        if (res.status >= 500 && attempt === 0) {
          await sleep(300);
          continue;
        }
        return { ok: false, status: res.status, body: null };
      }

      return { ok: true, data: (await res.json()) as T };
    } catch (err) {
      lastError = err;
      if ((err as Error).name === 'AbortError') break;
      if (attempt === 0) {
        await sleep(300);
        continue;
      }
    } finally {
      clearTimeout(timer);
      limiter.release();
    }
  }

  console.warn('[perek] request failed:', path, lastError instanceof Error ? lastError.message : lastError);
  return { ok: false, status: 0, body: null };
}

const isFood = (value: unknown): value is PerekFood => {
  if (!value || typeof value !== 'object') return false;
  const food = value as PerekFood;
  return typeof food.name === 'string' && food.name.trim().length > 0;
};

export type PerekSearchResult = {
  foods: PerekFood[];
  /** false — Perek недоступен; запрос нужно повторить позже. */
  ok: boolean;
};

/** Поиск по названию, бренду или штрихкоду. */
export async function searchPerek(q: string, limit = 20): Promise<PerekSearchResult> {
  if (!perekEnabled()) return { foods: [], ok: false };
  const query = q.trim();
  if (query.length < 2) return { foods: [], ok: true };
  const safeLimit = Math.min(20, Math.max(1, Math.trunc(limit)));
  const key = `search:${safeLimit}:${query.toLowerCase()}`;
  const cached = cacheGet<PerekFood[]>(key);
  if (cached) return { foods: cached, ok: true };

  const res = await fetchJson<PerekSearchResponse>(
    `/search?q=${encodeURIComponent(query)}&limit=${safeLimit}`,
  );
  if (!res.ok) {
    if (res.status !== 404) {
      console.warn('[perek] search failed:', query, res.status);
    }
    return { foods: [], ok: false };
  }

  const foods = (res.data.foods ?? []).filter(isFood);
  cacheSet(key, foods, foods.length ? SEARCH_TTL_MS : EMPTY_TTL_MS);
  return { foods, ok: true };
}

/** Подсказки при вводе. Не тратят лимит разных продуктов. */
export async function suggestPerek(q: string, limit = 8): Promise<string[]> {
  if (!perekEnabled()) return [];
  const query = q.trim();
  if (query.length < 2) return [];
  const safeLimit = Math.min(20, Math.max(1, Math.trunc(limit)));
  const key = `suggest:${safeLimit}:${query.toLowerCase()}`;
  const cached = cacheGet<string[]>(key);
  if (cached) return cached;

  const res = await fetchJson<PerekSuggestResponse>(
    `/suggest?q=${encodeURIComponent(query)}&limit=${safeLimit}`,
  );
  if (!res.ok) return [];

  const hints = (res.data.foods ?? [])
    .map((food) => food.name?.trim() ?? '')
    .filter(Boolean);
  cacheSet(key, hints, hints.length ? SEARCH_TTL_MS : EMPTY_TTL_MS);
  return hints;
}

/** КБЖУ по штрихкоду. null — кода нет в Perek или источник недоступен. */
export async function lookupBarcodePerek(code: string): Promise<PerekFood | null> {
  const clean = code.replace(/\D/g, '');
  if (!perekEnabled() || clean.length < 8) return null;

  const key = `barcode:${clean}`;
  const cached = cacheGet<{ food: PerekFood | null }>(key);
  if (cached) return cached.food;

  const res = await fetchJson<PerekBarcodeResponse>(
    `/barcode/${encodeURIComponent(clean)}`,
  );
  const food = res.ok && isFood(res.data.food) ? res.data.food : null;
  cacheSet(key, { food }, food ? BARCODE_TTL_MS : EMPTY_TTL_MS);
  return food;
}

const round1 = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
};

/** Данные Perek в виде, который принимает общий каталог продуктов. */
export type PerekProductData = {
  name: string;
  brand: string;
  barcode: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  servingG: number;
  extId?: string;
};

/**
 * Приводит карточку Perek к нашей модели. ext_id получает префикс,
 * чтобы не столкнуться с идентификаторами других источников.
 */
export function toProductData(food: PerekFood, barcode = ''): PerekProductData | null {
  const name = food.name.trim();
  if (!name) return null;

  const serving = (food.servings ?? []).find((s) => Number(s.grams) > 0);
  const servingG = serving ? Number(serving.grams) : 100;
  const per100 = food.per100 ?? {};

  return {
    name,
    brand: food.brand?.name?.trim() ?? '',
    barcode: String(barcode || food.barcodes?.[0] || '').trim(),
    kcal: round1(per100.kcal),
    protein: round1(per100.protein),
    fat: round1(per100.fat),
    carbs: round1(per100.carbs),
    servingG: servingG > 0 ? servingG : 100,
    extId: food.id ? `perek:${food.id}` : undefined,
  };
}
