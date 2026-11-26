import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aiEnabled } from '../config.js';
import { query } from '../db.js';
import { quotaState } from '../services/billing.js';
import { recognizeByText, recognizeDish } from '../services/ai.js';

/** Лог запросов к ИИ для админки: не блокирует ответ, ошибки глушим. */
const logAi = (userId: number, kind: string, success: boolean, started: number): void => {
  const ms = Math.min(600000, Math.max(0, Date.now() - started));
  void query('INSERT INTO ai_requests (user_id, kind, success, latency_ms) VALUES ($1, $2, $3, $4)', [userId, kind, success, Math.trunc(ms)]).catch(() => undefined);
};

/**
 * Картинка приходит прямо в теле запроса как data URL (base64).
 * Хранилища нет: сервер держит байты только на время запроса к ИИ.
 */
const bodySchema = z.object({
  image: z.string().min(100).max(8_000_000),
  note: z.string().trim().max(500).optional(),
});

export async function recognizeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/recognize/status', async () => ({ enabled: aiEnabled() }));

  /** Распознавание по текстовому описанию — без фотографии. */
  app.post('/api/recognize/text', async (req, reply) => {
    if (!aiEnabled()) {
      return reply.code(501).send({
        error: 'AI_NOT_CONFIGURED',
        message: 'Распознавание не настроено. Укажите OPENAI_API_KEY или заполните продукт вручную.',
      });
    }
    const body = z
      .object({ description: z.string().trim().min(3, 'Опишите блюдо подробнее').max(500) })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: body.error.issues[0]?.message ?? 'Проверьте описание',
      });
    }
    const quota = await quotaState(req.user!.id);
    if (quota.used >= quota.limit) {
      return reply.code(402).send({
        error: 'QUOTA_EXCEEDED',
        message: quota.plus
          ? 'Дневной лимит распознаваний блюд исчерпан. Попробуйте завтра.'
          : 'Бесплатные распознавания блюд на этот месяц закончились. С Plus - до 50 в день.',
        quota: quota,
      });
    }
    const started = Date.now();
    try {
      const res = await recognizeByText(body.data.description);
      logAi(req.user!.id, 'text', true, started);
      return res;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
      const message =
        statusCode === 400
          ? 'Не удалось разобрать описание.'
          : 'Не удалось определить блюдо. Попробуйте описать подробнее или заполните вручную.';
      logAi(req.user!.id, 'text', false, started);
      return reply.code(statusCode).send({ error: (err as Error).message, message });
    }
  });

  app.post('/api/recognize', async (req, reply) => {
    if (!aiEnabled()) {
      return reply.code(501).send({
        error: 'AI_NOT_CONFIGURED',
        message: 'Распознавание по фото не настроено. Укажите OPENAI_API_KEY или заполните продукт вручную.',
      });
    }
    const body = bodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: 'Нужна фотография блюда',
        issues: body.error.issues,
      });
    }
    if (!body.data.image.startsWith('data:image/')) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: 'Фото должно быть data URL с картинкой (base64)',
      });
    }

    const quota = await quotaState(req.user!.id);
    if (quota.used >= quota.limit) {
      return reply.code(402).send({
        error: 'QUOTA_EXCEEDED',
        message: quota.plus
          ? 'Дневной лимит распознаваний блюд исчерпан. Попробуйте завтра.'
          : 'Бесплатные распознавания блюд на этот месяц закончились. С Plus - до 50 в день.',
        quota: quota,
      });
    }
    const started = Date.now();
    try {
      const result = await recognizeDish(body.data.image, body.data.note);
      logAi(req.user!.id, 'photo', true, started);
      return result;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
      const message =
        statusCode === 400
          ? 'Не удалось прочитать изображение.'
          : 'Не удалось распознать блюдо. Попробуйте другое фото или заполните вручную.';
      logAi(req.user!.id, 'photo', false, started);
      return reply.code(statusCode).send({ error: (err as Error).message, message });
    }
  });
}
