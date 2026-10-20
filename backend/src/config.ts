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
};

export const aiEnabled = () => config.ai.apiKey.length > 0;
