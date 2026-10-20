import Fastify, { type FastifyError } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate } from './migrations.js';
import { pool } from './db.js';
import { diaryRoutes } from './routes/diary.js';
import { productRoutes } from './routes/products.js';
import { recognizeRoutes } from './routes/recognize.js';
import { settingsRoutes } from './routes/settings.js';

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

await app.register(diaryRoutes);
await app.register(productRoutes);
await app.register(settingsRoutes);
await app.register(recognizeRoutes);

// ---------- Статика SPA ----------
if (existsSync(staticRoot)) {
  await app.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/',
    index: ['index.html'],
    wildcard: false,
  });

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }
    return reply.sendFile(join(staticRoot, 'index.html'));
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
  app.log.info(`EasyFood API on http://0.0.0.0:${config.port}`);
}

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await start();
