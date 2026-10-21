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

const MONTHS_TITLE = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

/** Дни недели для сетки календаря: неделя начинается с понедельника. */
const CAL_WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

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
  // diff — сколько дней от выбранного дня до сегодняшнего.
  const diff = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  if (diff === -1) return 'Завтра';
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
};

export const formatDaySubtitle = (iso: string): string => {
  const d = fromISODate(iso);
  return `${WEEKDAYS[d.getDay()]} · ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
};

export const weekdayShort = (iso: string): string => WEEKDAYS[fromISODate(iso).getDay()];

export const dayNumber = (iso: string): number => fromISODate(iso).getDate();

export const isFuture = (iso: string): boolean => iso > today();

/** Месяц даты в формате YYYY-MM. */
export const monthOf = (iso: string): string => iso.slice(0, 7);

/** Сдвиг месяца: shiftMonth('2026-01', -1) → '2025-12'. */
export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Название месяца с годом: 'Октябрь 2026'. */
export const monthLabel = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_TITLE[m - 1] ?? ''} ${y}`;
};

export type CalendarCell = {
  /** Дата в формате YYYY-MM-DD. */
  iso: string;
  /** Число месяца. */
  day: number;
  /** Принадлежит ли ячейка показываемому месяцу. */
  inMonth: boolean;
};

/**
 * Ячейки календаря на месяц: полные недели с понедельника,
 * включая дни соседних месяцев по краям.
 */
export const monthCells = (month: string): CalendarCell[] => {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  // getDay() отдаёт 0 для воскресенья — сдвигаем к понедельнику.
  const offset = (first.getDay() + 6) % 7;
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  const start = new Date(y, m - 1, 1 - offset);

  const cells: CalendarCell[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ iso: toISODate(d), day: d.getDate(), inMonth: d.getMonth() === m - 1 });
  }
  return cells;
};

export { CAL_WEEKDAYS };
