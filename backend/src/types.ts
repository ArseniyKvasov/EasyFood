import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: number; username: string };
  }
}

export type MealId = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEALS: { id: MealId; name: string; emoji: string }[] = [
  { id: 'breakfast', name: 'Завтрак', emoji: '🌅' },
  { id: 'lunch', name: 'Обед', emoji: '☀️' },
  { id: 'dinner', name: 'Ужин', emoji: '🌙' },
  { id: 'snack', name: 'Перекус', emoji: '🍎' },
];

export type Nutrition = {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
};

export type Product = {
  id: number;
  source: 'own' | 'off' | 'ai';
  name: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  servingG: number;
  barcode: string;
  useCount: number;
};

export type Entry = {
  id: number;
  day: string;
  meal: MealId;
  productId: number | null;
  name: string;
  grams: number;
  nutrition: Nutrition;
  /** Значения на 100 г — снимок на момент добавления. */
  per100: Nutrition;
};

export type Targets = {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
};

export type Settings = Targets & {
  theme: 'auto' | 'light' | 'dark';
  onboarded: boolean;
};

export const emptyNutrition = (): Nutrition => ({ kcal: 0, protein: 0, fat: 0, carbs: 0 });
