import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { getSettings } from '../services/store.js';

const settingsBody = z.object({
  kcal: z.number().int().min(500).max(10000).optional(),
  protein: z.number().int().min(0).max(1000).optional(),
  fat: z.number().int().min(0).max(1000).optional(),
  carbs: z.number().int().min(0).max(2000).optional(),
  theme: z.enum(['auto', 'light', 'dark']).optional(),
  onboarded: z.boolean().optional(),
});

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async (req) => getSettings(req.user!.id));

  app.put('/api/settings', async (req, reply) => {
    const body = settingsBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    }
    const s = body.data;
    const userId = req.user!.id;
    await query(`INSERT INTO settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
    await query(
      `UPDATE settings SET
         kcal_target    = COALESCE($2, kcal_target),
         protein_target = COALESCE($3, protein_target),
         fat_target     = COALESCE($4, fat_target),
         carbs_target   = COALESCE($5, carbs_target),
         theme          = COALESCE($6, theme),
         onboarded      = COALESCE($7, onboarded),
         updated_at     = now()
       WHERE user_id = $1`,
      [userId, s.kcal ?? null, s.protein ?? null, s.fat ?? null, s.carbs ?? null, s.theme ?? null, s.onboarded ?? null],
    );
    return getSettings(userId);
  });
}
