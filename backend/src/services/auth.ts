import { randomBytes, timingSafeEqual } from 'node:crypto';
import { one, query } from '../db.js';
import type { YandexProfile } from './yandex.js';

const SESSION_DAYS = 30;

/** Сколько живёт незавершённый вход: state и code_verifier. */
const OAUTH_TTL_SECONDS = 10 * 60;
const OAUTH_COOKIE = 'bb_oauth';
const OAUTH_PATH = '/api/auth/yandex';

export type SessionUser = {
  id: number;
  login: string;
  displayName: string;
  avatarUrl: string;
};

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await query(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`, [
    token,
    userId,
    expires,
  ]);
  return token;
}

export async function findSession(token: string): Promise<SessionUser | null> {
  const row = await one<{
    id: string;
    login: string;
    display_name: string;
    avatar_url: string;
  }>(
    `SELECT u.id, u.login, u.display_name, u.avatar_url
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  return row
    ? {
        id: Number(row.id),
        login: row.login,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
      }
    : null;
}

export async function destroySession(token: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

/**
 * Создаёт аккаунт по профилю Яндекса или обновляет имя и почту,
 * если человек уже входил раньше. Возвращает id пользователя.
 */
export async function upsertYandexUser(profile: YandexProfile): Promise<number> {
  const row = await one<{ id: string }>(
    `INSERT INTO users (yandex_id, login, display_name, email, avatar_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (yandex_id) WHERE yandex_id IS NOT NULL
     DO UPDATE SET login        = EXCLUDED.login,
                   display_name = EXCLUDED.display_name,
                   email        = EXCLUDED.email,
                   avatar_url   = EXCLUDED.avatar_url,
                   updated_at   = now()
     RETURNING id`,
    [profile.id, profile.login, profile.displayName, profile.email, profile.avatarUrl],
  );
  if (!row) throw new Error('не удалось сохранить пользователя Яндекса');

  const userId = Number(row.id);
  await query(`INSERT INTO settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  return userId;
}

/** Разбирает заголовок Cookie в объект. */
export const parseCookies = (header: string | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
};

const cookie = (parts: (string | false)[]): string => parts.filter(Boolean).join('; ');

export const sessionCookie = (token: string, secure: boolean): string =>
  cookie([
    `bb_session=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86_400}`,
    secure && 'Secure',
  ]);

export const clearCookie = (): string =>
  'bb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';

/**
 * Состояние незавершённого входа: state и PKCE-верификатор в одной
 * httpOnly-куке, доступной только маршрутам Яндекс-входа.
 */
export const oauthCookie = (state: string, verifier: string, secure: boolean): string =>
  cookie([
    `${OAUTH_COOKIE}=${state}.${verifier}`,
    `Path=${OAUTH_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${OAUTH_TTL_SECONDS}`,
    secure && 'Secure',
  ]);

export const clearOAuthCookie = (): string =>
  `${OAUTH_COOKIE}=; Path=${OAUTH_PATH}; HttpOnly; SameSite=Lax; Max-Age=0`;

export function readOAuthCookie(
  header: string | undefined,
): { state: string; verifier: string } | null {
  const raw = parseCookies(header)[OAUTH_COOKIE];
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const state = raw.slice(0, dot);
  const verifier = raw.slice(dot + 1);
  return state && verifier ? { state, verifier } : null;
}

/** Сравнение без утечки времени: state пришёл извне. */
export const sameToken = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
