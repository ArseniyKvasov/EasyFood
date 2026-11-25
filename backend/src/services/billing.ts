
import { config } from '../config.js';
import { one, query } from '../db.js';
import { money, planName, sendMail } from './mail.js';
import { sendPushToUser } from './push.js';
import { charge as tbankCharge, TbankError } from './tbank.js';

/**
 * Подписки Plus: квоты, активация, рекурренты, dunning, уведомления.
 * Доступ: активная (или past_due/canceled до конца периода) подписка
 * либо ручной Plus из админки (users.plan + plan_until).
 */

export const ACTIVE_STATUSES = ['active', 'past_due', 'canceled'];

export const planMonths = (plan: string): number => (plan === 'year' ? 12 : 1);

export const planPrice = (plan: string): number =>
  plan === 'year' ? config.billing.yearPrice : config.billing.monthPrice;

export const planDescription = (plan: string): string =>
  plan === 'year' ? 'Подписка BiteBalance Plus, 12 месяцев' : 'Подписка BiteBalance Plus, 1 месяц';

export const orderId = (userId: number): string => {
  const rand = Math.random().toString(36).slice(2, 8);
  return 'bb-' + userId + '-' + Date.now().toString(36) + '-' + rand;
};

async function getSetting(key: string, fallback: number): Promise<number> {
  try {
    const row = await one<{ value: unknown }>('SELECT value FROM app_settings WHERE key = $1', [key]);
    const n = Number(row ? (row.value as number) : NaN);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/** Плюс активен: подписка с неистекшим периодом или ручной флаг из админки. */
export async function hasPlus(userId: number): Promise<boolean> {
  const row = await one<{ ok: string }>(
    'SELECT CASE WHEN EXISTS (' +
      'SELECT 1 FROM subscriptions s WHERE s.user_id = $1 AND s.status = ANY ($2) AND s.current_end > now()' +
      ') THEN ' + "'1'" + ' WHEN EXISTS (' +
      "SELECT 1 FROM users u WHERE u.id = $1 AND u.plan = 'plus' AND (u.plan_until IS NULL OR u.plan_until > now())" +
      ') THEN ' + "'1'" + ' ELSE ' + "'0'" + ' END AS ok',
    [userId, ACTIVE_STATUSES],
  );
  return row !== null && row.ok === '1';
}

export type SubscriptionRow = {
  user_id: string;
  plan: string;
  status: string;
  current_end: string | null;
  cancel_at: string | null;
  rebill_id: string | null;
};

export async function getSubscription(userId: number): Promise<SubscriptionRow | null> {
  return one<SubscriptionRow>(
    'SELECT user_id::text AS user_id, plan, status, current_end::text AS current_end, ' +
      "cancel_at::text AS cancel_at, rebill_id FROM subscriptions WHERE user_id = $1",
    [userId],
  );
}

async function countAi(userId: number, period: 'day' | 'month'): Promise<number> {
  const since = period === 'day' ? 'CURRENT_DATE' : "date_trunc('month', now())";
  const row = await one<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM ai_requests WHERE user_id = $1 AND success AND created_at >= ' + since,
    [userId],
  );
  return Number(row ? row.count : 0) || 0;
}

export type QuotaState = { plus: boolean; limit: number; used: number; period: 'day' | 'month' };

export async function quotaState(userId: number): Promise<QuotaState> {
  const plus = await hasPlus(userId);
  if (plus) {
    const limit = await getSetting('ai_plus_daily', 50);
    return { plus: true, limit: limit, used: await countAi(userId, 'day'), period: 'day' };
  }
  const limit = await getSetting('ai_free_monthly', 30);
  return { plus: false, limit: limit, used: await countAi(userId, 'month'), period: 'month' };
}

/** Продление/активация подписки после подтверждённой оплаты. */
export async function activateSubscription(
  userId: number,
  plan: string,
  rebillId: string | null,
): Promise<void> {
  const months = String(planMonths(plan));
  await query(
    'INSERT INTO subscriptions (user_id, plan, status, rebill_id, started_at, current_end, cancel_at, dunning_attempts, dunning_next_try, updated_at) ' +
      "VALUES ($1, $2, 'active', $3, now(), now() + ($4 || ' months')::interval, NULL, 0, NULL, now()) " +
      'ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, status = ' + "'active'" + ', ' +
      'rebill_id = COALESCE(EXCLUDED.rebill_id, subscriptions.rebill_id), ' +
      "current_end = CASE WHEN subscriptions.status = ANY ($5) AND subscriptions.current_end > now() " +
      "THEN subscriptions.current_end + ($4 || ' months')::interval " +
      "ELSE now() + ($4 || ' months')::interval END, " +
      'cancel_at = NULL, dunning_attempts = 0, dunning_next_try = NULL, updated_at = now()',
    [userId, plan, rebillId, months, ACTIVE_STATUSES],
  );
  await query(
    'UPDATE users SET plan = ' + "'plus'" + ', plan_until = (SELECT current_end FROM subscriptions WHERE user_id = $1), updated_at = now() WHERE id = $1',
    [userId],
  );
}

/** Отзыв доступа (возврат, ручная отмена админом): конец периода — сейчас. */
export async function revokeSubscription(userId: number): Promise<void> {
  await query(
    "UPDATE subscriptions SET status = 'canceled', cancel_at = COALESCE(cancel_at, now()), current_end = LEAST(current_end, now()), updated_at = now() WHERE user_id = $1",
    [userId],
  );
  await query(
    "UPDATE users SET plan = 'free', plan_until = NULL, updated_at = now() WHERE id = $1 " +
      'AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = $1 AND s.status = ANY ($2) AND s.current_end > now())',
    [userId, ACTIVE_STATUSES],
  );
}

type Contact = { email: string; login: string; name: string };

async function userContact(userId: number): Promise<Contact | null> {
  const row = await one<{ email: string; login: string; display_name: string }>(
    'SELECT email, login, display_name FROM users WHERE id = $1',
    [userId],
  );
  if (!row) return null;
  return { email: row.email || '', login: row.login || '', name: row.display_name || row.login || 'Пользователь' };
}

export type NoticeKind = 'precharge' | 'success' | 'failed' | 'suspended' | 'refunded' | 'canceled';

async function notify(userId: number, kind: NoticeKind, vars: Record<string, string>): Promise<void> {
  const u = await userContact(userId);
  if (!u) return;
  const subjects: Record<NoticeKind, string> = {
    precharge: 'BiteBalance Plus: списание через 3 дня',
    success: 'Оплата BiteBalance Plus прошла',
    failed: 'Не удалось списать оплату BiteBalance Plus',
    suspended: 'Подписка BiteBalance Plus приостановлена',
    refunded: 'Возврат по подписке BiteBalance Plus',
    canceled: 'Автопродление BiteBalance Plus отключено',
  };
  const texts: Record<NoticeKind, string> = {
    precharge:
      'Здравствуйте, ' + u.name + '!\n\nЧерез 3 дня (' + vars.end + ') мы спишем ' + vars.amount + ' за ' + vars.plan + '.\nОтменить автопродление можно в приложении: Настройки → Подписка.\n\nКоманда BiteBalance',
    success:
      'Здравствуйте, ' + u.name + '!\n\nОплата ' + vars.amount + ' за ' + vars.plan + ' прошла. Подписка активна до ' + vars.end + '.\nЧек отправлен этим письмом и доступен в банке.\n\nКоманда BiteBalance',
    failed:
      'Здравствуйте, ' + u.name + '!\n\nНе удалось списать ' + vars.amount + ' за ' + vars.plan + ' (' + vars.reason + ').\nПовторим попытку ' + vars.next + '. Проверьте лимит и баланс карты, чтобы не потерять Plus.\n\nКоманда BiteBalance',
    suspended:
      'Здравствуйте, ' + u.name + '!\n\nВсе попытки списания ' + vars.amount + ' за ' + vars.plan + ' не удались, доступ Plus приостановлен.\nОформите подписку заново в приложении, когда будет удобно.\n\nКоманда BiteBalance',
    refunded:
      'Здравствуйте, ' + u.name + '!\n\nМы вернули ' + vars.amount + ' за ' + vars.plan + '. Деньги придут на карту в срок вашего банка (обычно 1–5 дней).\nДоступ Plus отключён.\n\nКоманда BiteBalance',
    canceled:
      'Здравствуйте, ' + u.name + '!\n\nАвтопродление ' + vars.plan + ' отключено. Доступ Plus сохранится до ' + vars.end + ', новых списаний не будет.\n\nКоманда BiteBalance',
  };
  await sendMail(u.email, subjects[kind], texts[kind]);
  const pushBody: Record<NoticeKind, string> = {
    precharge: 'Через 3 дня спишем ' + vars.amount + ' за Plus',
    success: 'Оплата прошла, Plus активен до ' + vars.end,
    failed: 'Оплата не прошла, повторим ' + vars.next,
    suspended: 'Подписка Plus приостановлена',
    refunded: 'Возврат ' + vars.amount + ' оформлен',
    canceled: 'Автопродление отключено',
  };
  await sendPushToUser(userId, { title: 'BiteBalance Plus', body: pushBody[kind], url: '/' });
}

/** Оригинальный PaymentId для Charge: первый подтверждённый платёж с этим RebillId. */
async function originalPaymentId(userId: number, rebillId: string): Promise<string | null> {
  const row = await one<{ payment_id: string }>(
    "SELECT payment_id FROM payments WHERE user_id = $1 AND rebill_id = $2 AND status = 'confirmed' AND payment_id IS NOT NULL ORDER BY paid_at NULLS LAST, id LIMIT 1",
    [userId, rebillId],
  );
  return row ? row.payment_id : null;
}

export type TickResult = { charged: number; failed: number; notified: number };

/** Часовой тик: истечение ручных Plus, предуведомления, рекуррентные списания. */
export async function runBillingTick(): Promise<TickResult> {
  const out: TickResult = { charged: 0, failed: 0, notified: 0 };
  // Ручные Plus из админки с истекшим сроком — гасим.
  await query(
    "UPDATE users SET plan = 'free', plan_until = NULL, updated_at = now() WHERE plan = 'plus' " +
      'AND plan_until IS NOT NULL AND plan_until <= now() ' +
      'AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = users.id AND s.status = ANY ($1) AND s.current_end > now())',
    [ACTIVE_STATUSES],
  ).catch(function (err) {
    console.error('[billing] expire manual plus failed', (err as Error).message);
  });

  // Предуведомление за N дней до списания (один раз на период).
  try {
    const days = String(config.billing.prechargeDays);
    const soon = await query<{ user_id: string; current_end: string; plan: string }>(
      'SELECT user_id::text AS user_id, to_char(current_end, ' + "'DD.MM.YYYY'" + ') AS current_end, plan FROM subscriptions ' +
        "WHERE status = 'active' AND cancel_at IS NULL AND rebill_id IS NOT NULL " +
        'AND current_end > now() AND current_end <= now() + ($1 || ' + "' days'" + ')::interval ' +
        'AND (precharge_notified_at IS NULL OR precharge_notified_at < current_end - ($1 || ' + "' days'" + ')::interval)',
      [days],
    );
    for (const s of soon) {
      const uid = Number(s.user_id);
      await notify(uid, 'precharge', { end: s.current_end, amount: money(planPrice(s.plan)), plan: planName(s.plan) });
      await query('UPDATE subscriptions SET precharge_notified_at = now() WHERE user_id = $1', [uid]);
      out.notified += 1;
    }
  } catch (err) {
    console.error('[billing] precharge failed', (err as Error).message);
  }

  // Рекурренты: срок вышел, отмены нет, время попытки подошло.
  try {
    const due = await query<{ user_id: string; plan: string; rebill_id: string; dunning_attempts: string }>(
      'SELECT user_id::text AS user_id, plan, rebill_id, dunning_attempts::text AS dunning_attempts FROM subscriptions ' +
        "WHERE status IN ('active', 'past_due') AND cancel_at IS NULL AND rebill_id IS NOT NULL " +
        "AND current_end <= now() + interval '1 hour' AND (dunning_next_try IS NULL OR dunning_next_try <= now())",
      [],
    );
    for (const s of due) {
      await chargeOne(Number(s.user_id), s.plan, s.rebill_id, Number(s.dunning_attempts) || 0, out);
    }
  } catch (err) {
    console.error('[billing] recurrent failed', (err as Error).message);
  }
  return out;
}

async function chargeOne(
  userId: number,
  plan: string,
  rebillId: string,
  attempts: number,
  out: TickResult,
): Promise<void> {
  const amount = planPrice(plan);
  const oid = orderId(userId);
  const created = await query<{ id: string }>(
    "INSERT INTO payments (user_id, order_id, amount, plan, kind, status, raw) VALUES ($1, $2, $3, $4, 'recurrent', 'pending', '{}') RETURNING id::text AS id",
    [userId, oid, amount, plan],
  );
  const paymentRowId = created.length ? created[0].id : null;
  const failRow = async function (reason: string): Promise<void> {
    if (paymentRowId) {
      await query("UPDATE payments SET status = 'failed', raw = jsonb_set(raw, '{error}', $2::jsonb) WHERE id = $1", [
        paymentRowId,
        JSON.stringify(reason),
      ]);
    }
    const next = attempts + 1;
    const delays = config.billing.dunningDelaysHours;
    if (next > delays.length) {
      await query("UPDATE subscriptions SET status = 'past_due', dunning_attempts = $2, dunning_next_try = NULL, updated_at = now() WHERE user_id = $1", [
        userId,
        next,
      ]);
      await revokeIfExpired(userId);
      await notify(userId, 'suspended', { amount: money(amount), plan: planName(plan) });
    } else {
      const nextTry = new Date(Date.now() + delays[next - 1] * 3600000);
      await query("UPDATE subscriptions SET status = 'past_due', dunning_attempts = $2, dunning_next_try = $3, updated_at = now() WHERE user_id = $1", [
        userId,
        next,
        nextTry,
      ]);
      await notify(userId, 'failed', {
        amount: money(amount),
        plan: planName(plan),
        reason: reason,
        next: nextTry.toLocaleString('ru-RU'),
      });
    }
    out.failed += 1;
  };

  const orig = await originalPaymentId(userId, rebillId);
  if (!orig) {
    await failRow('нет исходного платежа для рекуррента');
    return;
  }
  try {
    const newPaymentId = await tbankCharge({ paymentId: orig, rebillId: rebillId, amount: amount, orderId: oid });
    if (paymentRowId) {
      await query("UPDATE payments SET status = 'confirmed', payment_id = $2, rebill_id = $3, paid_at = now() WHERE id = $1", [
        paymentRowId,
        newPaymentId,
        rebillId,
      ]);
    }
    await activateSubscription(userId, plan, rebillId);
    const sub = await getSubscription(userId);
    await notify(userId, 'success', {
      amount: money(amount),
      plan: planName(plan),
      end: sub && sub.current_end ? sub.current_end.slice(0, 10) : '',
    });
    out.charged += 1;
  } catch (err) {
    await failRow(err instanceof TbankError ? err.message : (err as Error).message);
  }
}

/** Если dunning исчерпан и срок вышел — снимаем ручной флаг Plus. */
async function revokeIfExpired(userId: number): Promise<void> {
  await query(
    "UPDATE users SET plan = 'free', plan_until = NULL, updated_at = now() WHERE id = $1 " +
      'AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = $1 AND s.status = ANY ($2) AND s.current_end > now())',
    [userId, ACTIVE_STATUSES],
  );
}

/** Планировщик подписок: тик раз в BILLING_TICK_MINUTES, первый — через 30 секунд. */
export function startBillingScheduler(): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const tick = function (): void {
    if (stopped) return;
    void runBillingTick()
      .then(function (r) {
        if (r.charged || r.failed || r.notified) console.log('[billing] tick', JSON.stringify(r));
      })
      .catch(function (err) {
        console.error('[billing] tick failed', (err as Error).message);
      })
      .finally(function () {
        if (!stopped) {
          timer = setTimeout(tick, Math.max(1, config.billing.tickMinutes) * 60000);
          if (timer && typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
            (timer as unknown as { unref: () => void }).unref();
          }
        }
      });
  };
  timer = setTimeout(tick, 30000);
  if (timer && typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
    (timer as unknown as { unref: () => void }).unref();
  }
  return function () {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
