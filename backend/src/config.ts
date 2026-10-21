import 'dotenv/config';

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (v: string | undefined, fallback: boolean) => {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};

// Пустая переменная означает «не отправлять поле в запросе».
const optionalNum = (v: string | undefined): number | undefined => {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const REASONING_EFFORTS = ['low', 'minimal', 'medium', 'high', 'xhigh', 'max', 'none'];

const reasoningEffort = (v: string | undefined): string | undefined => {
  const s = (v ?? '').trim().toLowerCase();
  return REASONING_EFFORTS.includes(s) ? s : undefined;
};

export const config = {
  port: num(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl:
    process.env.DATABASE_URL ??
    `postgresql://${process.env.POSTGRES_USER ?? 'easyfood'}:${process.env.POSTGRES_PASSWORD ?? 'easyfood'}` +
      `@${process.env.POSTGRES_HOST ?? 'localhost'}:${process.env.POSTGRES_PORT ?? '5432'}/${process.env.POSTGRES_DB ?? 'easyfood'}`,
  corsOrigin: (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  openFoodFacts: bool(process.env.OPEN_FOOD_FACTS_ENABLED, true),
  nutriapix: {
    apiKey: process.env.NUTRIAPIX_API_KEY ?? '',
    baseUrl: (process.env.NUTRIAPIX_BASE_URL ?? 'https://nutriapix.ru/api/v1').replace(/\/+$/, ''),
    /** Сколько запросов в месяц можно сделать к /food (лимит тестового токена). */
    monthlyBudget: num(process.env.NUTRIAPIX_MONTHLY_BUDGET, 1000),
    /** Сколько из этих запросов разрешено тратить на предзагрузку каталога. */
    backfillBudget: num(process.env.NUTRIAPIX_BACKFILL_BUDGET, 700),
    /** Сколько продуктов докачивать за один проход предзагрузки. */
    backfillBatch: num(process.env.NUTRIAPIX_BACKFILL_BATCH, 2),
    /** Как часто запускать предзагрузку, часов. */
    backfillIntervalHours: num(process.env.NUTRIAPIX_BACKFILL_INTERVAL_HOURS, 2),
  },
  ai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    // Не задано — 0.2, пустое значение — поле не отправляется (так требуют модели,
    // которые принимают только temperature=1, например Claude Haiku 5.5).
    temperature: process.env.OPENAI_TEMPERATURE === undefined ? 0.2 : optionalNum(process.env.OPENAI_TEMPERATURE),
    maxTokens: optionalNum(process.env.OPENAI_MAX_TOKENS),
    reasoningEffort: reasoningEffort(process.env.OPENAI_REASONING_EFFORT),
    responseFormat: (process.env.OPENAI_RESPONSE_FORMAT ?? 'json_object').trim(),
  },
  s3: {
    bucket: process.env.S3_BUCKET ?? '',
    /** Префикс внутри бакета для картинок пользователей. */
    location: (process.env.S3_LOCATION ?? 'uploads').replace(/^\/+|\/+$/g, ''),
    /** Префикс внутри бакета для дампов базы. */
    backupLocation: (process.env.S3_BACKUP_LOCATION ?? 'backups').replace(/^\/+|\/+$/g, ''),
    /** Пусто — стандартный AWS S3; для Yandex Cloud: https://storage.yandexcloud.net */
    endpointUrl: process.env.S3_ENDPOINT_URL ?? '',
    region: process.env.S3_REGION_NAME ?? 'ru-central1',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    /** MinIO и другие совместимые хранилища требуют адрес вида bucket/host. */
    forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, false),
    /** Сколько живёт подписанная ссылка на скачивание, секунд. */
    signedUrlExpire: num(process.env.S3_QUERYSTRING_EXPIRE, 900),
    /** Сколько дней хранить бэкапы базы в S3. */
    backupKeepDays: num(process.env.S3_BACKUP_KEEP_DAYS, 14),
    /** Сколько часов может жить загруженная картинка: дальше её удаляет чистка. */
    uploadKeepHours: num(process.env.S3_UPLOAD_KEEP_HOURS, 24),
  },
  maintenance: {
    /** Сколько дней хранить историю дневника. */
    historyRetentionDays: num(process.env.HISTORY_RETENTION_DAYS, 60),
    /** Как часто делать бэкап базы в S3, часов. */
    backupIntervalHours: num(process.env.BACKUP_INTERVAL_HOURS, 24),
    /** Как часто чистить историю, часов. */
    retentionIntervalHours: num(process.env.RETENTION_INTERVAL_HOURS, 6),
    /** Как часто удалять старые картинки из S3, часов. */
    uploadCleanupIntervalHours: num(process.env.UPLOAD_CLEANUP_INTERVAL_HOURS, 1),
  },
};

export const aiEnabled = () => config.ai.apiKey.length > 0;

/** S3 настроен — можно грузить картинки напрямую в хранилище. */
export const s3Enabled = () =>
  config.s3.bucket.length > 0 &&
  config.s3.accessKeyId.length > 0 &&
  config.s3.secretAccessKey.length > 0;
