import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// Скрипты воркспейса backend запускаются из backend/, а .env лежит в корне
// проекта — рядом с .env.example. Явный путь делает одинаковым поведение
// в dev, в тестах и в собранном dist. Уже заданные переменные окружения
// dotenv не перезаписывает, поэтому в контейнере приоритет у compose.
const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
if (existsSync(rootEnv)) loadEnv({ path: rootEnv });

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
  tbank: {
    /** Терминал эквайринга Т-Банка. Пусто — оплата выключена (checkout отвечает 503). */
    terminalKey: (process.env.TBANK_TERMINAL_KEY ?? '').trim(),
    password: (process.env.TBANK_PASSWORD ?? '').trim(),
    baseUrl: (process.env.TBANK_BASE_URL ?? 'https://securepay.tinkoff.ru/v2').replace(/\/+$/, ''),
    /** Куда вернуть после оплаты / неуспеха. Пусто — поля не отправляем. */
    successUrl: (process.env.TBANK_SUCCESS_URL ?? '').trim(),
    failUrl: (process.env.TBANK_FAIL_URL ?? '').trim(),
    /** Куда Т-Банк шлёт вебхуки. Пусто — собираем из SITE_URL. */
    notificationUrl: (process.env.TBANK_NOTIFICATION_URL ?? '').trim(),
    siteUrl: (process.env.SITE_URL ?? '').trim().replace(/\/+$/, ''),
    /** Налогообложение для чеков 54-ФЗ: usn_income (6%) по умолчанию. */
    taxation: (process.env.TBANK_TAXATION ?? 'usn_income').trim(),
    companyEmail: (process.env.TBANK_COMPANY_EMAIL ?? '').trim(),
  },
  billing: {
    /** Цены в копейках: 299 ₽/мес и 1990 ₽/год. */
    monthPrice: num(process.env.BILLING_MONTH_PRICE, 29900),
    yearPrice: num(process.env.BILLING_YEAR_PRICE, 199000),
    /** За сколько дней предупреждаем о списании (требует оферта). */
    prechargeDays: num(process.env.BILLING_PRECHARGE_DAYS, 3),
    /** Паузы dunning-повторов после неудачного списания, часов. */
    dunningDelaysHours: (process.env.BILLING_DUNNING_HOURS ?? '24,72')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
    /** Как часто тикает планировщик подписок, минут. */
    tickMinutes: num(process.env.BILLING_TICK_MINUTES, 60),
  },
  mail: {
    host: (process.env.SMTP_HOST ?? '').trim(),
    port: num(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: (process.env.SMTP_USER ?? '').trim(),
    pass: process.env.SMTP_PASS ?? '',
    from: (process.env.SMTP_FROM ?? '').trim(),
  },
  rateLimit: {
    /** Выключить все лимиты: RATE_LIMIT_ENABLED=0 (для отладки). */
    enabled: bool(process.env.RATE_LIMIT_ENABLED, true),
    /** Все /api/*: запросов в минуту с одного IP. */
    generalPerMin: num(process.env.RATE_LIMIT_GENERAL_PER_MIN, 300),
    /** Распознавание: запросов в минуту с одного пользователя. */
    aiPerMin: num(process.env.RATE_LIMIT_AI_PER_MIN, 30),
    /** Админка: запросов в минуту с одного пользователя. */
    adminPerMin: num(process.env.RATE_LIMIT_ADMIN_PER_MIN, 120),
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

/**
 * Админка: логины Яндекс ID через запятую, которые считаются суперадминами
 * даже пока в БД у них role='user'. Нужно для первичного входа:
 * задайте ADMIN_LOGINS, зайдите, дальше роли раздаются из интерфейса.
 */
const adminLogins = (process.env.ADMIN_LOGINS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const isBootstrapAdmin = (login: string): boolean =>
  adminLogins.includes(login.trim().toLowerCase());

/** Заданы ли ключи терминала — без них checkout недоступен. */
export const tbankEnabled = (): boolean =>
  config.tbank.terminalKey.length > 0 && config.tbank.password.length > 0;

/** Настроена ли отправка писем. */
export const mailEnabled = (): boolean =>
  config.mail.host.length > 0 && config.mail.from.length > 0;

/** Куда Т-Банк шлёт вебхуки: явный URL или SITE_URL + путь. */
export const tbankNotificationUrl = (): string => {
  if (config.tbank.notificationUrl) return config.tbank.notificationUrl;
  if (config.tbank.siteUrl) return config.tbank.siteUrl + '/api/billing/notify';
  return '';
};

/**
 * Чего не хватает для приёма оплаты — списком, человеческим языком.
 * Пустой массив означает «всё настроено». Этим пользуются checkout, лог
 * при старте и админка: одна функция, один текст ошибки.
 */
export const billingIssues = (): string[] => {
  const issues: string[] = [];
  if (!config.tbank.terminalKey) issues.push('TBANK_TERMINAL_KEY не задан');
  if (!config.tbank.password) issues.push('TBANK_PASSWORD не задан');
  if (!config.tbank.siteUrl && !config.tbank.notificationUrl) {
    issues.push('не задан SITE_URL (или TBANK_NOTIFICATION_URL) — банку некуда отправлять вебхук');
  }
  return issues;
};
