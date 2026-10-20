import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { one, query } from '../db.js';

const KEY_LENGTH = 64;
const SESSION_DAYS = 30;

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${hash}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  return timingSafeEqual(candidate, expected);
};

export type SessionUser = { id: number; username: string };

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
  const row = await one<{ id: string; username: string }>(
    `SELECT u.id, u.username
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  return row ? { id: Number(row.id), username: row.username } : null;
}

export async function destroySession(token: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE token = $1`, [token]);
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
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
};

export const sessionCookie = (token: string, secure: boolean): string =>
  [
    `ef_session=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86_400}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');

export const clearCookie = (): string =>
  'ef_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
