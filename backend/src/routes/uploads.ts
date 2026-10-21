import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config, s3Enabled } from '../config.js';
import { isUserKey, objectKey, presignUpload, removeObject } from '../services/s3.js';

const CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const requestSchema = z.object({
  contentType: z.enum(CONTENT_TYPES),
  size: z.number().int().positive().max(10_000_000),
});

const EXT: Record<(typeof CONTENT_TYPES)[number], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  /** Настроен ли S3 — фронтенд по этому флагу решает, грузить ли напрямую. */
  app.get('/api/uploads/status', async () => ({ enabled: s3Enabled() }));

  /**
   * Выдаёт подписанную ссылку на загрузку: браузер кладёт файл прямо в S3,
   * сервер приложения байты картинки не видит.
   */
  app.post('/api/uploads/presign', async (req, reply) => {
    if (!s3Enabled()) {
      return reply.code(501).send({
        error: 'S3_NOT_CONFIGURED',
        message: 'Хранилище не настроено. Фото отправляется через сервер.',
      });
    }

    const body = requestSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    }

    // Ключ формирует сервер: пользователь пишет только в свою папку.
    const key = objectKey(
      config.s3.location,
      String(req.user!.id),
      `${randomUUID()}.${EXT[body.data.contentType]}`,
    );

    const uploadUrl = await presignUpload(key, body.data.contentType);
    return {
      key,
      uploadUrl,
      contentType: body.data.contentType,
      expiresIn: config.s3.signedUrlExpire,
    };
  });

  /** Удаляет загруженный файл — если распознавание не удалось, мусор не копится. */
  app.delete('/api/uploads', async (req, reply) => {
    if (!s3Enabled()) return reply.code(501).send({ error: 'S3_NOT_CONFIGURED' });

    const key = String((req.query as { key?: string }).key ?? '');
    if (!key) return reply.code(400).send({ error: 'VALIDATION' });
    if (!isUserKey(req.user!.id, key)) {
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }
    await removeObject(key);
    return { ok: true };
  });
}
