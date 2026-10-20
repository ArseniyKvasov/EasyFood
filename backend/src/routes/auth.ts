import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { one, query } from '../db.js';
import {
  clearCookie,
  createSession,
  destroySession,
  hashPassword,
  parseCookies,
  sessionCookie,
  verifyPassword,
} from '../services/auth.js';

const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Логин — минимум 3 символа')
    .max(64, 'Логин — максимум 64 символа')
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Логин: латиница, цифры, «_», «-», «.»'),
  password: z.string().min(6, 'Пароль — минимум 6 символов').max(200),
});

const isSecure = (req: FastifyRequest): boolean => {
  const header = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(header) ? header[0] : (header ?? '');
  return proto.split(',')[0].trim() === 'https';
};

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', async (req, reply: FastifyReply) => {
    const body = credentials.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: body.error.issues[0]?.message ?? 'Проверьте логин и пароль',
      });
    }
    const { username, password } = body.data;

    const existing = await one(`SELECT id FROM users WHERE lower(username) = lower($1)`, [username]);
    if (existing) {
      return reply.code(409).send({ error: 'TAKEN', message: 'Этот логин уже занят' });
    }

    const rows = await query<{ id: string }>(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id`,
      [username, hashPassword(password)],
    );
    const userId = Number(rows[0].id);

    // Первый пользователь забирает данные, оставшиеся до появления аккаунтов.
    const legacy = await one<{ id: string }>(`SELECT id FROM users WHERE username = '__legacy__'`);
    if (legacy) {
      await query(`UPDATE entries SET user_id = $1 WHERE user_id = $2`, [userId, legacy.id]);
      await query(`UPDATE settings SET user_id = $1 WHERE user_id = $2`, [userId, legacy.id]);
      await query(`UPDATE products SET user_id = $1 WHERE user_id = $2`, [userId, legacy.id]);
      await query(`DELETE FROM users WHERE id = $1`, [legacy.id]);
    }

    await query(
      `INSERT INTO settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [userId],
    );

    const token = await createSession(userId);
    reply.header('Set-Cookie', sessionCookie(token, isSecure(req)));
    return reply.code(201).send({ username });
  });

  app.post('/api/auth/login', async (req, reply: FastifyReply) => {
    const body = credentials.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: 'Проверьте логин и пароль',
      });
    }
    const { username, password } = body.data;

    const user = await one<{ id: string; username: string; password_hash: string }>(
      `SELECT id, username, password_hash FROM users WHERE lower(username) = lower($1)`,
      [username],
    );
    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: 'BAD_CREDENTIALS', message: 'Неверный логин или пароль' });
    }

    const token = await createSession(Number(user.id));
    reply.header('Set-Cookie', sessionCookie(token, isSecure(req)));
    return { username: user.username };
  });

  app.post('/api/auth/logout', async (req, reply: FastifyReply) => {
    const token = parseCookies(req.headers.cookie).ef_session;
    if (token) await destroySession(token);
    reply.header('Set-Cookie', clearCookie());
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    return { username: req.user.username };
  });
}
