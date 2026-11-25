
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

type Bucket = { count: number; resetAt: number };

/** In-memory fixed window. Для одного инстанса достаточно; при нескольких
 *  репликах за nginx лимит действует на инстанс (сознательный компромисс
 *  без внешних зависимостей вроде Redis). */
const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60 * 1000;

setInterval(function () {
  const now = Date.now();
  for (const entry of buckets) {
    if (entry[1].resetAt <= now) buckets.delete(entry[0]);
  }
}, 5 * 60 * 1000).unref?.();

function take(key: string, limit: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || cur.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, retryAfter: 0 };
  }
  if (cur.count < limit) {
    cur.count += 1;
    return { ok: true, retryAfter: 0 };
  }
  return { ok: false, retryAfter: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
}

/** IP за прокси: берём первый из X-Forwarded-For, иначе соединение. */
function clientIp(req: { headers: Record<string, unknown>; ip: string }): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : typeof fwd === 'string' ? fwd.split(',')[0] : '';
  const real = req.headers['x-real-ip'];
  const ip = (typeof first === 'string' && first.trim()) || (typeof real === 'string' && real.trim()) || req.ip;
  return 'ip:' + ip;
}

function limited(reply: { code: (n: number) => any; header: (k: string, v: string) => any; send: (b: unknown) => any }, retryAfter: number): void {
  reply.header('Retry-After', String(retryAfter));
  reply.code(429).send({ error: 'RATE_LIMITED', message: 'Слишком много запросов. Попробуйте через ' + retryAfter + ' сек.' });
}

/**
 * Регистрировать ДО всех маршрутов: режет общий поток по IP,
 * включая /api/auth/* (защита от долбёжки входа).
 */
export async function rateLimitHook(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async function (req, reply) {
    if (!config.rateLimit.enabled) return;
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/') || path === '/api/health') return;
    const res = take('gen:' + clientIp(req as never), config.rateLimit.generalPerMin);
    if (!res.ok) return limited(reply as never, res.retryAfter);
  });
}

/**
 * Регистрировать ПОСЛЕ authHook: строгие лимиты по пользователю
 * для дорогих (ИИ) и привилегированных (админка) маршрутов.
 */
export async function userRateLimitHook(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async function (req, reply) {
    if (!config.rateLimit.enabled || !req.user) return;
    const path = req.url.split('?')[0];
    if (req.method === 'POST' && (path === '/api/recognize' || path === '/api/recognize/text')) {
      const res = take('ai:' + req.user.id, config.rateLimit.aiPerMin);
      if (!res.ok) return limited(reply as never, res.retryAfter);
      return;
    }
    if (path.startsWith('/api/admin/')) {
      const res = take('adm:' + req.user.id, config.rateLimit.adminPerMin);
      if (!res.ok) return limited(reply as never, res.retryAfter);
    }
  });
}
