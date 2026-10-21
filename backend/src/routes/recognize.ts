import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aiEnabled } from '../config.js';
import { recognizeByText, recognizeDish } from '../services/ai.js';

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
    try {
      const result = await recognizeDish(body.data.image, body.data.note);
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
