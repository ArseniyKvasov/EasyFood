import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aiEnabled, s3Enabled } from '../config.js';
import { recognizeByText, recognizeDish } from '../services/ai.js';
import { isUserKey, presignDownload } from '../services/s3.js';

const bodySchema = z
  .object({
    /** Ключ картинки в S3 — основной путь, байты через сервер не идут. */
    key: z.string().min(1).max(300).optional(),
    /** Запасной путь: картинка прямо в теле запроса (когда S3 не настроен). */
    image: z.string().min(100).max(8_000_000).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.key || d.image, { message: 'Нужна фотография' });

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
    try {
      return await recognizeByText(body.data.description);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
      const message =
        statusCode === 400
          ? 'Не удалось разобрать описание.'
          : 'Не удалось определить блюдо. Попробуйте описать подробнее или заполните вручную.';
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
      return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    }

    // Картинка лежит в S3: отдаём ИИ подписанную ссылку, а не байты.
    let imageUrl: string;
    if (body.data.key) {
      if (!s3Enabled()) {
        return reply.code(501).send({
          error: 'S3_NOT_CONFIGURED',
          message: 'Хранилище не настроено. Выберите фото заново.',
        });
      }
      if (!isUserKey(req.user!.id, body.data.key)) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Чужое фото' });
      }
      imageUrl = await presignDownload(body.data.key);
    } else {
      imageUrl = body.data.image!;
    }

    try {
      const result = await recognizeDish(imageUrl, body.data.note);
      return result;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
      const message =
        statusCode === 400
          ? 'Не удалось прочитать изображение.'
          : 'Не удалось распознать блюдо. Попробуйте другое фото или заполните вручную.';
      return reply.code(statusCode).send({ error: (err as Error).message, message });
    }
  });
}
