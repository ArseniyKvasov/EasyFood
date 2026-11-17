import { sendNotification, setVapidDetails } from 'web-push';
import { config, pushEnabled } from '../config.js';
import { query } from '../db.js';

/** Время напоминаний по Москве (UTC+3 круглый год, перевода часов нет). */
const SLOTS: [number, number][] = [
  [7, 0],
  [13, 0],
  [17, 0],
  [20, 30],
];

const MSK_OFFSET_HOURS = 3;

/** Текст напоминания. */
export const PUSH_MESSAGE = { title: 'BiteBalance', body: 'You can now', url: '/' };

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

type StoredSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

let vapidReady = false;

const ensureVapid = (): boolean => {
  if (!pushEnabled()) return false;
  if (!vapidReady) {
    setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
    vapidReady = true;
  }
  return true;
};

/** Сохраняет подписку браузера: один endpoint — одна строка. */
export async function saveSubscription(
  userId: number,
  sub: PushSubscriptionInput,
): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           p256dh  = EXCLUDED.p256dh,
           auth    = EXCLUDED.auth`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
  );
}

export async function removeSubscription(userId: number, endpoint: string): Promise<void> {
  await query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [
    userId,
    endpoint,
  ]);
}

export async function isSubscribed(userId: number): Promise<boolean> {
  const rows = await query('SELECT 1 FROM push_subscriptions WHERE user_id = $1 LIMIT 1', [
    userId,
  ]);
  return rows.length > 0;
}

/** Рассылает напоминание всем подпискам. */
export async function sendReminder(): Promise<{ sent: number; removed: number }> {
  if (!ensureVapid()) return { sent: 0, removed: 0 };

  const subs = await query<StoredSubscription>(
    'SELECT id::text AS id, endpoint, p256dh, auth FROM push_subscriptions',
  );
  const payload = JSON.stringify(PUSH_MESSAGE);
  let sent = 0;
  let removed = 0;

  for (const sub of subs) {
    try {
      await sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 404/410 — браузер отозвал подписку, чистим её.
      if (status === 404 || status === 410) {
        await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(
          () => undefined,
        );
        removed += 1;
      } else {
        console.error('[push] send failed', status ?? '', (err as Error).message);
      }
    }
  }

  return { sent, removed };
}

/** Ближайшее время напоминания в UTC. */
export const nextSlot = (now: Date = new Date()): Date => {
  const candidates = SLOTS.map(([hour, minute]) => {
    const d = new Date(now);
    d.setUTCHours(hour - MSK_OFFSET_HOURS, minute, 0, 0);
    if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  });
  return candidates.sort((a, b) => a.getTime() - b.getTime())[0]!;
};

/**
 * Планировщик напоминаний: спит до ближайшего слота, рассылает push
 * и засыпает до следующего. Возвращает функцию остановки.
 */
export function startPushScheduler(): () => void {
  if (!pushEnabled()) {
    console.warn('[push] VAPID-ключи не заданы — напоминания выключены');
    return () => undefined;
  }

  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const schedule = (): void => {
    if (stopped) return;
    const next = nextSlot();
    const delay = Math.max(0, next.getTime() - Date.now());
    console.log(`[push] следующее напоминание: ${next.toISOString()}`);
    timer = setTimeout(() => {
      void sendReminder()
        .then(({ sent, removed }) => {
          console.log(`[push] напоминание отправлено: ${sent}, удалено подписок: ${removed}`);
        })
        .catch((err) => console.error('[push] рассылка не удалась', err))
        .finally(schedule);
    }, delay);
    timer.unref?.();
  };

  schedule();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
