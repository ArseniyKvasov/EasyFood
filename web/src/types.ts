export type MealId = 'breakfast' | 'lunch' | 'dinner' | 'snack';

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

export type MealBucket = {
  id: MealId;
  name: string;
  emoji: string;
  kcal: number;
  entries: Entry[];
};

export type Diary = {
  date: string;
  settings: Settings;
  totals: Nutrition;
  meals: MealBucket[];
};

export type Recognition = {
  name: string;
  grams: number;
  nutrition: Nutrition;
  confidence: number;
};
