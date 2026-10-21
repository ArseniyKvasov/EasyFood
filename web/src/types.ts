export type MealId = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type Nutrition = {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
};

export type Product = {
  id: number;
  source: 'own' | 'off' | 'ai' | 'np';
  /** Владелец продукта: каталог платформы или личный продукт пользователя. */
  owner: 'platform' | 'user';
  name: string;
  /** Бренд производителя. */
  brand: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  servingG: number;
  barcode: string;
  useCount: number;
  /** Идентификатор продукта во внешнем каталоге. */
  extId?: string;
  extSlug?: string;
  /** Продукт найден, но КБЖУ ещё не подтянуты — нужно забрать из API. */
  pending?: boolean;
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

/** День в сводке за месяц: сколько калорий и сколько записей. */
export type DaySummary = {
  day: string;
  kcal: number;
  entries: number;
};

export type MonthSummary = {
  month: string;
  days: DaySummary[];
};

export type Recognition = {
  name: string;
  grams: number;
  nutrition: Nutrition;
  confidence: number;
};
