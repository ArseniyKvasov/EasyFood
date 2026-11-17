import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

/** Профиль, который Яндекс отдаёт по токену. */
export type YandexProfile = {
  /** Идентификатор пользователя в Яндексе — по нему узнаём аккаунт. */
  id: string;
  login: string;
  displayName: string;
  email: string;
  avatarUrl: string;
};

/** Причина, по которой вход не удался: фронтенд показывает её текстом. */
export type YandexErrorCode = 'token' | 'profile';

export class YandexError extends Error {
  code: YandexErrorCode;
  constructor(code: YandexErrorCode, message: string) {
    super(message);
    this.name = 'YandexError';
    this.code = code;
  }
}

const TIMEOUT_MS = 10_000;

/** Случайная строка для state и code_verifier. */
export const randomToken = (bytes: number): string => randomBytes(bytes).toString('base64url');

/** PKCE: S256-преобразование верификатора. */
export const codeChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

/** Адрес страницы согласия Яндекса. */
export function authorizeUrl(input: {
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(`${config.yandex.oauthBaseUrl}/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.yandex.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  if (config.yandex.scope) url.searchParams.set('scope', config.yandex.scope);
  url.searchParams.set('code_challenge', input.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Меняет код подтверждения на OAuth-токен. */
export async function exchangeCode(input: {
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
    client_id: config.yandex.clientId,
    client_secret: config.yandex.clientSecret,
  });

  let res: Response;
  try {
    res = await fetch(`${config.yandex.oauthBaseUrl}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new YandexError('token', `Яндекс не ответил на обмен кода: ${String(err)}`);
  }

  const data = (await res.json().catch(() => null)) as
    | { access_token?: unknown; error?: unknown; error_description?: unknown }
    | null;

  if (!res.ok || typeof data?.access_token !== 'string' || !data.access_token) {
    const reason =
      typeof data?.error_description === 'string'
        ? data.error_description
        : typeof data?.error === 'string'
          ? data.error
          : `HTTP ${res.status}`;
    throw new YandexError('token', `Не удалось получить токен Яндекса: ${reason}`);
  }

  return data.access_token;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Забирает профиль по токену. */
export async function fetchProfile(token: string): Promise<YandexProfile> {
  let res: Response;
  try {
    res = await fetch(`${config.yandex.loginBaseUrl}/info?format=json`, {
      headers: { Authorization: `OAuth ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new YandexError('profile', `Яндекс не отдал профиль: ${String(err)}`);
  }

  if (!res.ok) {
    throw new YandexError('profile', `Яндекс не отдал профиль: HTTP ${res.status}`);
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const id = text(data?.id);
  if (!id) {
    throw new YandexError('profile', 'В ответе Яндекса нет идентификатора пользователя');
  }

  const login = text(data?.login);
  const displayName =
    text(data?.display_name) || text(data?.real_name) || text(data?.first_name) || login;

  const emails = Array.isArray(data?.emails) ? data.emails : [];
  const email = text(data?.default_email) || text(emails[0]);

  // Портрет отдаётся отдельным правом: без него is_avatar_empty = true.
  const avatarId = data?.is_avatar_empty === true ? '' : text(data?.default_avatar_id);
  const avatarUrl = avatarId ? `https://avatars.yandex.net/get-yapic/${avatarId}/islands-200` : '';

  return { id, login, displayName, email, avatarUrl };
}
