import { config } from '../config.js';
import type { Nutrition } from '../types.js';

export type Recognition = {
  name: string;
  grams: number;
  nutrition: Nutrition;
  confidence: number;
};

const PROMPT = `Ты — эксперт по питанию. На фотографии еды определи блюдо и оцени его состав.
Ответь СТРОГО одним JSON-объектом без markdown:
{
  "name": "название блюда на русском, до 40 символов",
  "grams": 250,
  "kcal": 430,
  "protein": 32,
  "fat": 12,
  "carbs": 45,
  "confidence": 0.8
}
Значения kcal, protein, fat, carbs — итог за указанную порцию grams в граммах.
Если блюдо непонятно, всё равно дай наиболее вероятную оценку и confidence ниже 0.5.`;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const RECOGNITION_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    grams: { type: 'number' },
    kcal: { type: 'number' },
    protein: { type: 'number' },
    fat: { type: 'number' },
    carbs: { type: 'number' },
    confidence: { type: 'number' },
  },
  required: ['name', 'grams', 'kcal', 'protein', 'fat', 'carbs', 'confidence'],
  additionalProperties: false,
} as const;

const buildBody = (imageDataUrl: string): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    model: config.ai.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } },
        ],
      },
    ],
  };

  // Claude Haiku 5.5 отклоняет temperature, отличный от 1, — поле не отправляем.
  if (config.ai.temperature !== undefined) {
    body.temperature = config.ai.temperature;
  }
  if (config.ai.maxTokens !== undefined) {
    body.max_tokens = config.ai.maxTokens;
  }
  // Уровень «размышления» для reasoning-моделей (OpenRouter: reasoning.effort).
  if (config.ai.reasoningEffort) {
    body.reasoning = { effort: config.ai.reasoningEffort };
  }
  if (config.ai.responseFormat === 'json_schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'dish', strict: true, schema: RECOGNITION_SCHEMA },
    };
  } else {
    body.response_format = { type: 'json_object' };
  }

  return body;
};

export async function recognizeDish(imageDataUrl: string): Promise<Recognition> {
  if (!config.ai.apiKey) {
    throw Object.assign(new Error('AI_NOT_CONFIGURED'), { statusCode: 501 });
  }
  if (!imageDataUrl.startsWith('data:image/')) {
    throw Object.assign(new Error('INVALID_IMAGE'), { statusCode: 400 });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify(buildBody(imageDataUrl)),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[ai] request failed', res.status, detail.slice(0, 400));
      throw Object.assign(new Error('AI_REQUEST_FAILED'), { statusCode: 502 });
    }

    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = payload.choices?.[0]?.message?.content ?? '';
    const json = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());

    const grams = Math.max(1, num(json.grams) || 100);
    const per100 = {
      kcal: (num(json.kcal) / grams) * 100,
      protein: (num(json.protein) / grams) * 100,
      fat: (num(json.fat) / grams) * 100,
      carbs: (num(json.carbs) / grams) * 100,
    };

    return {
      name: String(json.name ?? 'Распознанное блюдо').slice(0, 60),
      grams,
      nutrition: per100,
      confidence: Math.min(1, Math.max(0, num(json.confidence) || 0.6)),
    };
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw Object.assign(new Error('AI_BAD_RESPONSE'), { statusCode: 502 });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
