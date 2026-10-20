const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** Локальная дата в формате YYYY-MM-DD (без сдвига по UTC). */
export const toISODate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const fromISODate = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

export const today = (): string => toISODate(new Date());

export const shiftDate = (iso: string, days: number): string => {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
};

export const formatDayTitle = (iso: string): string => {
  const d = fromISODate(iso);
  const now = new Date();
  const diff = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  if (diff === 0) return 'Сегодня';
  if (diff === -1) return 'Вчера';
  if (diff === 1) return 'Завтра';
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
};

export const formatDaySubtitle = (iso: string): string => {
  const d = fromISODate(iso);
  return `${WEEKDAYS[d.getDay()]} · ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
};

export const weekdayShort = (iso: string): string => WEEKDAYS[fromISODate(iso).getDay()];

export const dayNumber = (iso: string): number => fromISODate(iso).getDate();

export const isFuture = (iso: string): boolean => iso > today();
