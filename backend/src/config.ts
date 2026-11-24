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
    `postgresql://${process.env.POSTGRES_USER ?? 'bitebalance'}:${process.env.POSTGRES_PASSWORD ?? 'bitebalance'}` +
      `@${process.env.POSTGRES_HOST ?? 'localhost'}:${process.env.POSTGRES_PORT ?? '5432'}/${process.env.POSTGRES_DB ?? 'bitebalance'}`,
  corsOrigin: (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  openFoodFacts: bool(process.env.OPEN_FOOD_FACTS_ENABLED, true),
  perek: {
    apiKey: (process.env.PEREK_API_KEY ?? '').trim(),
    baseUrl: (process.env.PEREK_BASE_URL ?? 'https://perek.us/api/v1/foods').replace(/\/+$/, ''),
    /**
     * Лимит бесплатного тарифа — 20 запросов в минуту. Держим чуть ниже,
     * чтобы параллельные пользователи не упирались в 429.
     */
    requestsPerMinute: num(process.env.PEREK_REQUESTS_PER_MINUTE, 18),
    /** Сколько дней не ходить в Perek за уже обогащённым запросом. */
    queryTtlDays: num(process.env.PEREK_QUERY_TTL_DAYS, 30),
    /** Для запросов без результатов — короче, чтобы подхватить новые продукты. */
    emptyQueryTtlDays: num(process.env.PEREK_EMPTY_QUERY_TTL_DAYS, 7),
    /** Сколько запросов обогащать за один проход обслуживания. */
    syncBatch: num(process.env.PEREK_SYNC_BATCH, 3),
    /** Как часто запускать фоновую синхронизацию, минут. */
    syncIntervalMinutes: num(process.env.PEREK_SYNC_INTERVAL_MINUTES, 15),
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
  yandex: {
    /** Идентификатор и секрет приложения из https://oauth.yandex.ru */
    clientId: (process.env.YANDEX_CLIENT_ID ?? '').trim(),
    clientSecret: (process.env.YANDEX_CLIENT_SECRET ?? '').trim(),
    /**
     * Адрес возврата после входа. Должен дословно совпадать с Redirect URI
     * в настройках приложения. Пусто — собирается из заголовков запроса
     * (x-forwarded-proto + host), что удобно для локальной разработки.
     */
    redirectUri: (process.env.YANDEX_REDIRECT_URI ?? '').trim(),
    /** Права, которые запрашиваем у Яндекс ID. Пусто — только id и логин. */
    scope: (process.env.YANDEX_SCOPE ?? 'login:info login:email').trim(),
    /** Базовые адреса API Яндекса: меняются только в тестах с mock-сервером. */
    oauthBaseUrl: (process.env.YANDEX_OAUTH_BASE_URL ?? 'https://oauth.yandex.ru').replace(/\/+$/, ''),
    loginBaseUrl: (process.env.YANDEX_LOGIN_BASE_URL ?? 'https://login.yandex.ru').replace(/\/+$/, ''),
  },
  push: {
    /** Ключи VAPID для Web Push. Сгенерировать: npm run vapid */
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    /** Контакт администратора: mailto:... или https://... */
    subject: process.env.VAPID_SUBJECT ?? 'mailto:admin@bitebalance.local',
  },
  backup: {
    /** Папка для дампов базы (pg_dump в gzip). Относительный путь — от корня проекта. */
    dir: (process.env.BACKUP_DIR ?? 'data/backups').replace(/\/+$/, ''),
    /** Сколько дней хранить дампы. */
    keepDays: num(process.env.BACKUP_KEEP_DAYS, 14),
    /** Как часто делать бэкап базы, часов. */
    intervalHours: num(process.env.BACKUP_INTERVAL_HOURS, 24),
  },
  maintenance: {
    /** Сколько дней хранить историю дневника. */
    historyRetentionDays: num(process.env.HISTORY_RETENTION_DAYS, 60),
    /** Как часто чистить историю, часов. */
    retentionIntervalHours: num(process.env.RETENTION_INTERVAL_HOURS, 6),
  },
};

export const aiEnabled = () => config.ai.apiKey.length > 0;

/** Задан ли ключ Perek — без него поиск идёт только по своей базе. */
export const perekEnabled = () => config.perek.apiKey.length > 0;

/** Заданы ли ключи приложения Яндекс ID — без них вход невозможен. */
export const yandexEnabled = () =>
  config.yandex.clientId.length > 0 && config.yandex.clientSecret.length > 0;

/** Заданы ли ключи VAPID — без них Web Push не работает. */
export const pushEnabled = () =>
  config.push.publicKey.length > 0 && config.push.privateKey.length > 0;
