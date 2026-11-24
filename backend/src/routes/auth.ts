import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config, yandexEnabled } from '../config.js';
import {
  clearCookie,
  clearOAuthCookie,
  createSession,
  destroySession,
  oauthCookie,
  parseCookies,
  readOAuthCookie,
  sameToken,
  sessionCookie,
  upsertYandexUser,
} from '../services/auth.js';
import {
  authorizeUrl,
  codeChallenge,
  exchangeCode,
  fetchProfile,
  randomToken,
  YandexError,
} from '../services/yandex.js';

const CALLBACK_PATH = '/api/auth/yandex/callback';
/**
 * Куда возвращаем пользователя после входа. Если приложение живёт отдельно
 * от лендинга (например на /app/), путь задаётся через APP_HOME.
 */
const HOME = (process.env.APP_HOME ?? '/').trim() || '/';

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value)?.split(',')[0].trim() ?? '';

const isSecure = (req: FastifyRequest): boolean =>
  first(req.headers['x-forwarded-proto']) === 'https' || req.protocol === 'https';

/**
 * Адрес возврата. В продакшене задаётся YANDEX_REDIRECT_URI — он должен
 * дословно совпадать с Redirect URI в настройках приложения Яндекса.
 * Без настройки собираем из заголовков запроса: так удобно локально.
 */
const redirectUri = (req: FastifyRequest): string => {
  if (config.yandex.redirectUri) return config.yandex.redirectUri;
  const proto = first(req.headers['x-forwarded-proto']) || req.protocol || 'http';
  const host = first(req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
  return `${proto}://${host}${CALLBACK_PATH}`;
};

/** Возврат на экран входа с кодом ошибки — текст подберёт фронтенд. */
const fail = (reply: FastifyReply, code: string): FastifyReply => {
  reply.header('Set-Cookie', clearOAuthCookie());
  return reply.redirect(`${HOME}?auth_error=${encodeURIComponent(code)}`);
};

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** Начало входа: уводит на страницу согласия Яндекса. */
  app.get('/api/auth/yandex/start', async (req, reply: FastifyReply) => {
    if (!yandexEnabled()) {
      // Из браузера возвращаем на экран входа с понятным текстом,
      // а API-клиенту отвечаем обычной ошибкой.
      if ((req.headers.accept ?? '').includes('text/html')) {
        return reply.redirect(`${HOME}?auth_error=config`);
      }
      return reply.code(503).send({
        error: 'OAUTH_DISABLED',
        message: 'Вход через Яндекс не настроен: задайте YANDEX_CLIENT_ID и YANDEX_CLIENT_SECRET',
      });
    }

    const state = randomToken(24);
    const verifier = randomToken(48);
    reply.header('Set-Cookie', oauthCookie(state, verifier, isSecure(req)));
    return reply.redirect(
      authorizeUrl({
        redirectUri: redirectUri(req),
        state,
        challenge: codeChallenge(verifier),
      }),
    );
  });

  /** Возврат из Яндекса: обменивает код на профиль и открывает сессию. */
  app.get(CALLBACK_PATH, async (req, reply: FastifyReply) => {
    if (!yandexEnabled()) return fail(reply, 'config');

    const query = (req.query ?? {}) as Record<string, string | string[] | undefined>;
    const error = first(query.error);
    if (error) return fail(reply, error === 'access_denied' ? 'cancelled' : 'denied');

    const pending = readOAuthCookie(req.headers.cookie);
    if (!pending) return fail(reply, 'cookie');

    const state = first(query.state);
    if (!state || !sameToken(state, pending.state)) return fail(reply, 'state');

    const code = first(query.code);
    if (!code) return fail(reply, 'code');

    try {
      const token = await exchangeCode({
        code,
        redirectUri: redirectUri(req),
        verifier: pending.verifier,
      });
      const profile = await fetchProfile(token);
      const userId = await upsertYandexUser(profile);
      const session = await createSession(userId);

      reply.header('Set-Cookie', [
        clearOAuthCookie(),
        sessionCookie(session, isSecure(req)),
      ]);
      return reply.redirect(HOME);
    } catch (err) {
      req.log.error({ err }, 'yandex sign-in failed');
      return fail(reply, err instanceof YandexError ? err.code : 'internal');
    }
  });

  app.post('/api/auth/logout', async (req, reply: FastifyReply) => {
    const token = parseCookies(req.headers.cookie).bb_session;
    if (token) await destroySession(token);
    reply.header('Set-Cookie', clearCookie());
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    return {
      login: req.user.login,
      displayName: req.user.displayName,
      avatarUrl: req.user.avatarUrl,
    };
  });
}
