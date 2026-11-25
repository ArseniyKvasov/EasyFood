import Fastify, { type FastifyError } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate } from './migrations.js';
import { pool } from './db.js';
import { authHook } from './middleware/auth.js';
import { rateLimitHook, userRateLimitHook } from './middleware/rateLimit.js';
import { adminRoutes } from './routes/admin.js';
import { funnelRoutes } from './routes/funnel.js';
import { authRoutes } from './routes/auth.js';
import { paymentsAuthRoutes, paymentsPublicRoutes } from './routes/payments.js';
import { diaryRoutes } from './routes/diary.js';
import { productRoutes } from './routes/products.js';
import { pushRoutes } from './routes/push.js';
import { recognizeRoutes } from './routes/recognize.js';
import { settingsRoutes } from './routes/settings.js';
import { startBillingScheduler } from './services/billing.js';
import { runRetention } from './services/maintenance.js';
import { startPushScheduler } from './services/push.js';

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, '../../web/dist');
const webDistInContainer = resolve(here, '../web/dist');
const staticRoot = existsSync(webDist) ? webDist : webDistInContainer;

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: config.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
  },
  bodyLimit: 12 * 1024 * 1024,
});

if (config.corsOrigin.length) {
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && config.corsOrigin.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Headers', 'Content-Type');
      reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') return reply.code(204).send();
    }
  });
}

app.setErrorHandler((err: FastifyError, req, reply) => {
  const statusCode = err.statusCode ?? 500;
  if (statusCode >= 500) req.log.error({ err }, 'request failed');
  reply.code(statusCode).send({
    error: err.name === 'FastifyError' ? 'BAD_REQUEST' : 'INTERNAL',
    message: err.message,
  });
});

app.get('/api/health', async () => ({ ok: true, version: '1.0.0' }));

await rateLimitHook(app);
await app.register(authRoutes);
await app.register(paymentsPublicRoutes);
await authHook(app);
await userRateLimitHook(app);

await app.register(diaryRoutes);
await app.register(productRoutes);
await app.register(settingsRoutes);
await app.register(adminRoutes);
await app.register(funnelRoutes);
await app.register(paymentsAuthRoutes);
await app.register(recognizeRoutes);
await app.register(pushRoutes);

// ---------- Статика SPA ----------
if (existsSync(staticRoot)) {
  // Один корень: лендинг в dist/, приложение в dist/app/.
  // Так сайт работает и за nginx, и при прямом заходе в контейнер.
  await app.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/',
    index: ['index.html'],
  });

  const notFoundPage = join(staticRoot, '404.html');

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }

    // Неизвестный путь внутри приложения отдаёт SPA.
    if (req.url === '/app' || req.url.startsWith('/app/')) {
      return reply.header('Cache-Control', 'no-cache').sendFile('app/index.html');
    }

    if (existsSync(notFoundPage)) {
      return reply.code(404).sendFile('404.html');
    }
    return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  app.log.info(`[web] serving static files from ${staticRoot}`);
}

async function start(): Promise<void> {
  try {
    await migrate();
  } catch (err) {
    app.log.error(err, 'database migration failed');
    process.exit(1);
  }
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`BiteBalance API on http://0.0.0.0:${config.port}`);
  if (!config.perek.apiKey) {
    app.log.warn('PEREK_API_KEY не задан: поиск работает по своей базе, штрихкоды — через Open Food Facts');
  }

  // История дневника живёт 60 дней. Чистим при старте, дальше этим
  // занимается сервис maintenance.
  void runRetention()
    .then((removed) => {
      if (removed) app.log.info(`retention: removed ${removed} entries`);
    })
    .catch((err) => app.log.error(err, 'retention cleanup failed'));

  // Напоминания в 7:00, 13:00, 17:00 и 20:30 МСК.
  stopPush = startPushScheduler();

  // Подписки: предуведомления, рекурренты, dunning.
  stopBilling = startBillingScheduler();
  app.log.info('[billing] scheduler started');
}

let stopPush: () => void = () => undefined;
let stopBilling: () => void = () => undefined;

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  stopPush();
  stopBilling();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await start();
