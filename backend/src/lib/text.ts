/**
 * Приводит название к виду, удобному для поиска: нижний регистр,
 * «ё» → «е», без знаков препинания, с одним пробелом между словами.
 */
export const normalizeName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');

/** Бренд уже упомянут в названии — добавлять его в скобках не нужно. */
export const brandInName = (name: string, brand: string): boolean => {
  const n = normalizeName(name);
  const b = normalizeName(brand);
  if (!b) return true;
  // Ищем бренд как отдельное слово: «Данон» не считается упомянутым в «Данони».
  return n.split(' ').some((word) => word === b || word.startsWith(b) || b.startsWith(word));
};

/**
 * Название для показа: «Название (Бренд)», если бренд есть
 * и его ещё нет в самом названии.
 */
export const displayName = (name: string, brand: string): string => {
  const clean = name.trim();
  const b = brand.trim();
  if (!b || !clean) return clean || b;
  if (brandInName(clean, b)) return clean;
  return `${clean} (${b})`;
};
