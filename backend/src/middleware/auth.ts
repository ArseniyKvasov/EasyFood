import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { findSession, parseCookies } from '../services/auth.js';

/** Эндпоинты, доступные без сессии. */
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/logout',
  '/api/auth/yandex/start',
  '/api/auth/yandex/callback',
  // Вебхук Т-Банка: у банка нет сессии, подлинность — по подписи Token.
  '/api/billing/notify',
]);

/**
 * Хук добавляется прямо в корневом контексте Fastify — поэтому он не
 * затрагивает /api/auth/*, но защищает все остальные маршруты.
 */
export async function authHook(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') return;

    const path = req.url.split('?')[0];

    // Статика и оболочка SPA публичны: в них нет пользовательских данных,
    // всё содержимое подгружается через защищённые /api/*.
    if (!path.startsWith('/api/')) return;

    if (PUBLIC_PATHS.has(path)) return;

    const token = parseCookies(req.headers.cookie).bb_session;
    if (!token) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Требуется вход в аккаунт' });
    }

    const user = await findSession(token);
    if (!user) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Сессия истекла, войдите снова' });
    }

    try {
      const r = await pool.query('SELECT is_blocked FROM users WHERE id = $1', [user.id]);
      if (r.rows[0]?.is_blocked && !path.startsWith('/api/admin/')) {
        return reply.code(403).send({ error: 'BLOCKED', message: 'Аккаунт заблокирован' });
      }
    } catch { /* таблица users всегда есть */ }

    req.user = user;
  });
}
