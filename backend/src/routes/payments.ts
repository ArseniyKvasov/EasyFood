
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { billingIssues, tbankEnabled } from '../config.js';
import { one, query } from '../db.js';
import {
  activateSubscription,
  getSubscription,
  hasPlus,
  orderId,
  planDescription,
  planMonths,
  planPrice,
  quotaState,
  revokeSubscription,
} from '../services/billing.js';
import { money, sendMail } from '../services/mail.js';
import { getState, initPayment, verifyWebhook } from '../services/tbank.js';

/**
 * Оплата Plus через Т-Банк. Вебхук — публичный маршрут (регистрируется
 * до authHook, как /api/auth/*), остальное — только с сессией.
 */

const checkoutBody = z.object({
  plan: z.enum(['month', 'year']),
  /** Согласие покупателя на автоматические списания: ставится чек-боксом. */
  consent: z.boolean().optional(),
});

type PaymentRow = {
  id: string;
  user_id: string;
  order_id: string;
  payment_id: string | null;
  amount: string;
  plan: string;
  kind: string;
  status: string;
};

/** Публичный вебхук Т-Банка: только подпись, сессий здесь нет. */
export async function paymentsPublicRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/billing/notify', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    if (!verifyWebhook(body)) {
      req.log.warn('[billing] webhook: bad signature');
      return reply.code(200).send('OK');
    }
    const orderIdValue = String(body.OrderId || '');
    const status = String(body.Status || '');
    const success = body.Success === true;
    const payment = orderIdValue
      ? await one<PaymentRow>(
        'SELECT id::text AS id, user_id::text AS user_id, order_id, payment_id, amount::text AS amount, plan, kind, status FROM payments WHERE order_id = $1',
        [orderIdValue],
      )
      : null;
    if (!payment) {
      req.log.warn({ orderId: orderIdValue }, '[billing] webhook for unknown order');
      return reply.code(200).send('OK');
    }
    const userId = Number(payment.user_id);
    const paymentId = typeof body.PaymentId === 'string' ? body.PaymentId : null;
    const rebillId = typeof body.RebillId === 'string' && body.RebillId ? body.RebillId : null;

    // Идемпотентность: повтор вебхука по уже подтверждённой оплате — просто OK.
    if (payment.status === 'confirmed') return reply.code(200).send('OK');

    if (success && status === 'CONFIRMED') {
      await query(
        "UPDATE payments SET status = 'confirmed', payment_id = COALESCE($2, payment_id), rebill_id = COALESCE($3, rebill_id), paid_at = now(), raw = raw || $4::jsonb WHERE id = $1",
        [payment.id, paymentId, rebillId, JSON.stringify({ notified: true })],
      );
      await activateSubscription(userId, payment.plan, rebillId);
      req.log.info({ orderId: orderIdValue, userId: userId }, '[billing] payment confirmed');
      return reply.code(200).send('OK');
    }
    if (status === 'REJECTED' || status === 'REVERSED' || status === 'REFUNDED' || status === 'PARTIAL_REFUNDED') {
      const next = status === 'REJECTED' || status === 'REVERSED' ? 'rejected' : 'refunded';
      await query('UPDATE payments SET status = $2 WHERE id = $1', [payment.id, next]);
      if (next === 'refunded') {
        await revokeSubscription(userId);
        req.log.info({ orderId: orderIdValue, userId: userId }, '[billing] payment refunded');
      }
      return reply.code(200).send('OK');
    }
    req.log.info({ orderId: orderIdValue, status: status }, '[billing] webhook: промежуточный статус');
    return reply.code(200).send('OK');
  });
}

export async function paymentsAuthRoutes(app: FastifyInstance): Promise<void> {
  /** Текущий тариф, квота ИИ и цены — для пейволла и настроек. */
  app.get('/api/billing/status', async (req) => {
    const userId = req.user!.id;
    const sub = await getSubscription(userId);
    const plus = await hasPlus(userId);
    const quota = await quotaState(userId);
    const row = await one<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
    return {
      plus: plus,
      plan: sub ? sub.plan : plus ? 'manual' : 'free',
      status: sub ? sub.status : null,
      current_end: sub ? sub.current_end : null,
      cancel_at: sub ? sub.cancel_at : null,
      has_rebill: Boolean(sub && sub.rebill_id),
      email: row ? row.email : '',
      quota: quota,
      prices: { month: planPrice('month'), year: planPrice('year') },
      tbank: tbankEnabled(),
    };
  });

  /** Создать платёж и получить ссылку на страницу банка. Сумма — только с сервера. */
  app.post('/api/checkout', async (req, reply) => {
    const issues = billingIssues();
    if (issues.length) {
      // Главная причина «оплата не работает»: не хватает переменных окружения.
      // Пишем это явно в лог, чтобы было видно в docker compose logs.
      req.log.error('[billing] checkout отклонён: ' + issues.join('; '));
      return reply.code(503).send({
        error: 'BILLING_DISABLED',
        message: 'Оплата временно недоступна',
        issues: issues,
      });
    }
    const parsed = checkoutBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', issues: parsed.error.issues });
    const plan = parsed.data.plan;
    const userId = req.user!.id;
    const sub = await getSubscription(userId);
    if (sub && (sub.status === 'active' || sub.status === 'past_due') && sub.current_end && new Date(sub.current_end).getTime() > Date.now()) {
      return reply.code(409).send({ error: 'ALREADY_PLUS', message: 'Подписка уже активна' });
    }
    const amount = planPrice(plan);
    const oid = orderId(userId);
    // Согласие фиксируем вместе с платежом: при споре с банком видно,
    // что покупатель подтвердил автоплатежи до оплаты.
    const consentRecord = {
      consent: parsed.data.consent === true,
      at: new Date().toISOString(),
      amount: amount,
      plan: plan,
    };
    const created = await query<{ id: string }>(
      "INSERT INTO payments (user_id, order_id, amount, plan, kind, status, raw) VALUES ($1, $2, $3, $4, 'initial', 'pending', $5::jsonb) RETURNING id::text AS id",
      [userId, oid, amount, plan, JSON.stringify(consentRecord)],
    );
    const rowId = created.length ? created[0].id : null;
    const me = await one<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
    try {
      const init = await initPayment({
        amount: amount,
        orderId: oid,
        description: planDescription(plan),
        customerKey: String(userId),
        email: me ? me.email : '',
        plan: plan,
        userId: userId,
      });
      await query('UPDATE payments SET payment_id = $2 WHERE id = $1', [rowId, init.paymentId]);
      req.log.info('[billing] Init прошёл, вариант параметров: ' + init.variant);
      return { paymentUrl: init.paymentUrl, orderId: oid };
    } catch (err) {
      await query("UPDATE payments SET status = 'failed' WHERE id = $1", [rowId]);
      const bankResponse = (err as { response?: unknown }).response;
      req.log.error(
        { err: err, orderId: oid, userId: userId, plan: plan, amount: amount, bankResponse: bankResponse },
        '[billing] Init в Т-Банке не прошёл — платёж не создан. Ответ банка: ' +
          ((err as Error).message || 'нет') +
          (bankResponse ? ' | ' + JSON.stringify(bankResponse) : ''),
      );
      return reply.code(502).send({
        error: 'INIT_FAILED',
        message: 'Банк отклонил создание платежа. Попробуйте позже или напишите в поддержку.',
      });
    }
  });

  /** Отмена автопродления: доступ живёт до конца оплаченного периода. */
  app.post('/api/billing/cancel', async (req, reply) => {
    const userId = req.user!.id;
    const sub = await getSubscription(userId);
    if (!sub) return reply.code(404).send({ error: 'NO_SUBSCRIPTION', message: 'Подписки нет' });
    await query("UPDATE subscriptions SET cancel_at = COALESCE(cancel_at, now()), updated_at = now() WHERE user_id = $1", [userId]);
    const fresh = await getSubscription(userId);
    try {
      const me = await one<{ email: string; display_name: string }>('SELECT email, display_name FROM users WHERE id = $1', [userId]);
      const end = fresh && fresh.current_end ? fresh.current_end.slice(0, 10) : '';
      await sendMail(
        me ? me.email : '',
        'Автопродление BiteBalance Plus отключено',
        'Здравствуйте' + (me && me.display_name ? ', ' + me.display_name : '') + '!\n\nАвтопродление отключено. Доступ Plus сохранится до ' + end + ', новых списаний не будет.\n\nКоманда BiteBalance',
      );
    } catch { /* письмо не должно ломать отмену */ }
    return { ok: true, current_end: fresh ? fresh.current_end : null };
  });

  /** Ручная сверка: если вебхук потерялся, подтянуть статус из банка. */
  app.post('/api/billing/sync', async (req, reply) => {
    if (!tbankEnabled()) {
      req.log.error('[billing] sync недоступен: ' + billingIssues().join('; '));
      return reply.code(503).send({ error: 'BILLING_DISABLED' });
    }
    const userId = req.user!.id;
    const last = await one<PaymentRow>(
      "SELECT id::text AS id, user_id::text AS user_id, order_id, payment_id, amount::text AS amount, plan, kind, status FROM payments WHERE user_id = $1 AND payment_id IS NOT NULL AND status IN ('pending', 'failed') ORDER BY id DESC LIMIT 1",
      [userId],
    );
    if (!last || !last.payment_id) return { ok: true, status: 'nothing' };
    try {
      const state = await getState(last.payment_id);
      if (state.Status === 'CONFIRMED') {
        await query("UPDATE payments SET status = 'confirmed', paid_at = COALESCE(paid_at, now()), rebill_id = COALESCE(rebill_id, $2) WHERE id = $1", [
          last.id,
          typeof state.RebillId === 'string' ? state.RebillId : null,
        ]);
        await activateSubscription(userId, last.plan, typeof state.RebillId === 'string' ? state.RebillId : null);
        return { ok: true, status: 'confirmed' };
      }
      return { ok: true, status: String(state.Status || 'unknown') };
    } catch (err) {
      return reply.code(502).send({ error: 'SYNC_FAILED', message: 'Не удалось свериться с банком' });
    }
  });
}

/** Сколько месяцев даёт план — для писем и админки. */
export const monthsForPlan = planMonths;
