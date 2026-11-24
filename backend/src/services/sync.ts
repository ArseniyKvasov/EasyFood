import { config, perekEnabled } from '../config.js';
import { query } from '../db.js';
import { normalizeName } from '../lib/text.js';
import { searchPerek, toProductData } from './perek.js';
import { upsertCatalogProduct } from './catalog.js';

/**
 * Постепенное наполнение своей базы по реальному спросу.
 *
 * Каждый уникальный поисковый запрос ставится в очередь. Первый раз он
 * обогащается из Perek, результаты остаются в products. Дальше запрос
 * обслуживается локально, пока не истечёт TTL.
 *
 * Это не выкачивание справочника целиком: Perek запрещает массовый экспорт,
 * поэтому очередь растёт только из того, что реально искали пользователи.
 */

export type QueryState = {
  query: string;
  raw_query: string;
  hits: number;
  found: number;
  status: 'pending' | 'done' | 'empty' | 'failed';
  enriched_at: Date | null;
  next_try: Date;
  attempts: number;
};

export type SyncOutcome = {
  query: string;
  found: number;
  ok: boolean;
};

const FAIL_RETRY_MINUTES = 10;
const ERROR_MAX_LENGTH = 500;

/** Запоминает запрос и возвращает его состояние в очереди. */
export async function touchQuery(rawQuery: string): Promise<QueryState | null> {
  const norm = normalizeName(rawQuery);
  if (!norm) return null;

  const rows = await query<QueryState>(
    `INSERT INTO product_queries (query, raw_query, hits, last_seen)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (query) DO UPDATE
       SET hits = product_queries.hits + 1,
           raw_query = EXCLUDED.raw_query,
           last_seen = now()
     RETURNING query, raw_query, hits, found, status, enriched_at, next_try, attempts`,
    [norm, rawQuery.trim()],
  );
  return rows[0] ?? null;
}

/** Текущее состояние запроса без увеличения счётчика обращений. */
export async function getQueryState(rawQuery: string): Promise<QueryState | null> {
  const norm = normalizeName(rawQuery);
  if (!norm) return null;
  const rows = await query<QueryState>(
    `SELECT query, raw_query, hits, found, status, enriched_at, next_try, attempts
       FROM product_queries WHERE query = $1`,
    [norm],
  );
  return rows[0] ?? null;
}

/** Пора ли снова идти в Perek за этим запросом. */
export const queryNeedsEnrichment = (state: QueryState): boolean =>
  new Date(state.next_try).getTime() <= Date.now();

/** Запрос обогащён: запоминаем, сколько продуктов нашлось, и ставим TTL. */
export async function markQueryEnriched(queryText: string, found: number): Promise<void> {
  const days = found > 0 ? config.perek.queryTtlDays : config.perek.emptyQueryTtlDays;
  const ttlDays = Math.max(1, days);
  const nextTry = new Date(Date.now() + ttlDays * 86_400_000);

  await query(
    `UPDATE product_queries
        SET status = $2, found = $3, enriched_at = now(),
            attempts = attempts + 1, last_error = NULL, next_try = $4
      WHERE query = $1`,
    [queryText, found > 0 ? 'done' : 'empty', found, nextTry],
  );
}

/** Perek не ответил: попробуем позже, запрос остаётся в очереди. */
export async function markQueryFailed(queryText: string, error: string): Promise<void> {
  const nextTry = new Date(Date.now() + FAIL_RETRY_MINUTES * 60_000);
  await query(
    `UPDATE product_queries
        SET status = 'failed', attempts = attempts + 1,
            last_error = $2, next_try = $3
      WHERE query = $1`,
    [queryText, error.slice(0, ERROR_MAX_LENGTH), nextTry],
  );
}

/**
 * Один проход фоновой синхронизации: берём самые частые запросы, которые
 * ждут обогащения, и складываем найденные карточки в products.
 */
export async function runCatalogSync(
  limit = config.perek.syncBatch,
): Promise<SyncOutcome[]> {
  if (!perekEnabled()) return [];
  const batch = Math.max(1, Math.trunc(limit));

  const rows = await query<{ query: string; raw_query: string }>(
    `SELECT query, raw_query FROM product_queries
      WHERE next_try <= now()
        AND (enriched_at IS NULL OR status = 'failed')
      ORDER BY hits DESC, last_seen DESC
      LIMIT $1`,
    [batch],
  );

  const outcomes: SyncOutcome[] = [];
  for (const row of rows) {
    const res = await searchPerek(row.raw_query, 20);
    if (!res.ok) {
      await markQueryFailed(row.query, 'Perek request failed');
      outcomes.push({ query: row.raw_query, found: 0, ok: false });
      // Если API недоступен, не долбим его остальными запросами пачки.
      break;
    }

    let found = 0;
    for (const food of res.foods) {
      const data = toProductData(food);
      if (!data) continue;
      await upsertCatalogProduct({ source: 'perek', ...data });
      found += 1;
    }
    await markQueryEnriched(row.query, found);
    outcomes.push({ query: row.raw_query, found, ok: true });
  }

  return outcomes;
}

export type SyncStats = {
  total: number;
  pending: number;
  done: number;
  empty: number;
  failed: number;
};

/** Состояние очереди — для логов обслуживания. */
export async function syncStats(): Promise<SyncStats> {
  const rows = await query<{
    total: number;
    pending: number;
    done: number;
    empty: number;
    failed: number;
  }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'pending')::int AS pending,
            count(*) FILTER (WHERE status = 'done')::int AS done,
            count(*) FILTER (WHERE status = 'empty')::int AS empty,
            count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM product_queries`,
  );
  return rows[0] ?? { total: 0, pending: 0, done: 0, empty: 0, failed: 0 };
}
