import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config, pushEnabled } from '../config.js';
import { isSubscribed, removeSubscription, saveSubscription } from '../services/push.js';

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});

const NOT_CONFIGURED = {
  error: 'PUSH_NOT_CONFIGURED',
  message: 'Напоминания не настроены: не заданы ключи VAPID',
};

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  /** Включены ли напоминания и подписан ли текущий браузер. */
  app.get('/api/push/status', async (req) => ({
    enabled: pushEnabled(),
    subscribed: await isSubscribed(req.user!.id),
  }));

  /** Публичный ключ VAPID: по нему браузер создаёт подписку. */
  app.get('/api/push/public-key', async (_req, reply) => {
    if (!pushEnabled()) return reply.code(501).send(NOT_CONFIGURED);
    return { key: config.push.publicKey };
  });

  /** Подписка браузера на напоминания. */
  app.post('/api/push/subscribe', async (req, reply) => {
    if (!pushEnabled()) return reply.code(501).send(NOT_CONFIGURED);

    const body = z.object({ subscription: subscriptionSchema }).safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    }
    await saveSubscription(req.user!.id, body.data.subscription);
    return { ok: true };
  });

  /** Отписка — например, при выходе из аккаунта. */
  app.delete('/api/push/subscribe', async (req, reply) => {
    const body = z.object({ endpoint: z.string().min(1).max(1000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION' });
    await removeSubscription(req.user!.id, body.data.endpoint);
    return { ok: true };
  });
}
