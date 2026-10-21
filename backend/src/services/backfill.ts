import { config } from '../config.js';
import { query } from '../db.js';
import { upsertCatalogProduct } from './catalog.js';
import { BudgetExceededError, getFood, nutriapixEnabled, searchFood } from './nutriapix.js';

/**
 * С чего начинаем наполнять каталог. Запросы разбираются по очереди,
 * сверху самые частые.
 */
const SEED_QUERIES = [
  'гречка',
  'рис белый',
  'овсянка',
  'макароны',
  'куриная грудка',
  'яйцо куриное',
  'молоко',
  'кефир',
  'творог',
  'сметана',
  'сыр',
  'йогурт',
  'банан',
  'яблоко',
  'хлеб',
  'сахар',
  'масло подсолнечное',
  'оливковое масло',
  'картофель',
  'морковь',
  'говядина',
  'фарш',
  'колбаса',
  'лосось',
  'творожная масса',
  'печенье',
  'шоколад',
  'сок',
  'кофе',
  'протеиновый батончик',
];

/** Кладёт очередь запросов в базу (один раз). */
const ensureQueue = async (): Promise<void> => {
  for (const [i, q] of SEED_QUERIES.entries()) {
    await query(
      `INSERT INTO catalog_backfill (query, cursor, done, ord) VALUES ($1, 0, FALSE, $2)
       ON CONFLICT (query) DO NOTHING`,
      [q, i],
    );
  }
};

export type BackfillResult = {
  query: string;
  added: number;
  scanned: number;
  done: boolean;
};

/**
 * Один проход предзагрузки: берём следующий запрос из очереди,
 * находим в Nutriapix продукты и сохраняем их КБЖУ в нашу базу.
 *
 * Поиск в Nutriapix лимита не расходует, а вот запрос карточки продукта
 * (/food) — расходует, поэтому на предзагрузку выделен отдельный бюджет.
 */
export const runBackfill = async (): Promise<BackfillResult | null> => {
  if (!nutriapixEnabled()) return null;

  await ensureQueue();

  const job = await query<{ query: string; cursor: number }>(
    `SELECT query, cursor FROM catalog_backfill
      WHERE NOT done
      ORDER BY ord, cursor
      LIMIT 1`,
  );
  if (!job.length) return null;

  const { query: term, cursor } = job[0];
  const page = cursor + 1;
  const found = await searchFood(term, page, 20);
  const results = found.results ?? [];
  if (!results.length) {
    await query(`UPDATE catalog_backfill SET done = TRUE WHERE query = $1`, [term]);
    return { query: term, added: 0, scanned: 0, done: true };
  }

  let added = 0;
  for (const item of results) {
    if (added >= config.nutriapix.backfillBatch) break;
    try {
      const food = await getFood({ slug: item.food_slug }, 'nutriapix.food.backfill', config.nutriapix.backfillBudget);
      if (!food) continue;
      await upsertCatalogProduct({
        source: 'np',
        name: food.food_name,
        brand: food.brand_name ?? '',
        kcal: Math.round((food.nutritions?.calories ?? 0) * 10) / 10,
        protein: Math.round((food.nutritions?.protein?.total_protein ?? 0) * 10) / 10,
        fat: Math.round((food.nutritions?.fat?.total_fat ?? 0) * 10) / 10,
        carbs: Math.round((food.nutritions?.carbohydrate?.total_carbohydrate ?? 0) * 10) / 10,
        servingG: 100,
        extId: food.food_id,
        extSlug: food.slug,
      });
      added += 1;
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        console.warn('[backfill] бюджет предзагрузки исчерпан');
        return { query: term, added, scanned: results.length, done: false };
      }
      console.warn('[backfill] не удалось загрузить продукт:', (err as Error).message);
    }
  }

  const lastPage = found.pages ?? 1;
  const done = page >= lastPage || (added === 0 && page >= lastPage);
  await query(`UPDATE catalog_backfill SET cursor = $2, done = $3 WHERE query = $1`, [
    term,
    done ? cursor : page,
    done,
  ]);

  return { query: term, added, scanned: results.length, done };
};

/** Насколько наполнен каталог — для отладочного эндпоинта. */
export const backfillStats = async (): Promise<{ queries: number; done: number }> => {
  const rows = await query<{ total: string; done: string }>(
    `SELECT count(*) AS total, count(*) FILTER (WHERE done) AS done FROM catalog_backfill`,
  );
  return { queries: Number(rows[0]?.total ?? 0), done: Number(rows[0]?.done ?? 0) };
};

export const seedQueryCount = SEED_QUERIES.length;
