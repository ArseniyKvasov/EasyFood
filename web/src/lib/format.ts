export const round = (value: number, digits = 0): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(digits);
};

/** «1 234.5» — с неразрывным пробелом между разрядами, разделитель — точка. */
export const num = (value: number, digits = 0): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
};

export const plural = (count: number, one: string, few: string, many: string): string => {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
};

export const grams = (value: number): string => `${num(value)} г`;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const scale = (n: Nutritionish, g: number) => ({
  kcal: (n.kcal * g) / 100,
  protein: (n.protein * g) / 100,
  fat: (n.fat * g) / 100,
  carbs: (n.carbs * g) / 100,
});

type Nutritionish = { kcal: number; protein: number; fat: number; carbs: number };
