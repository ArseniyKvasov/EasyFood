import type { FastifyInstance } from 'fastify';
import { findSession, parseCookies } from '../services/auth.js';

/** Эндпоинты, доступные без сессии. */
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
]);

/**
 * Хук добавляется прямо в корневом контексте Fastify — поэтому он не
 * затрагивает /api/auth/*, но защищает все остальные маршруты.
 */
export async function authHook(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') return;

    const path = req.url.split('?')[0];
    if (PUBLIC_PATHS.has(path)) return;

    const token = parseCookies(req.headers.cookie).ef_session;
    if (!token) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Требуется вход в аккаунт' });
    }

    const user = await findSession(token);
    if (!user) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Сессия истекла, войдите снова' });
    }

    req.user = user;
  });
}
