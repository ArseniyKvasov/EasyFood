import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { CAL_WEEKDAYS, monthCells, monthLabel, monthOf, shiftMonth, today } from '../lib/date';
import { num } from '../lib/format';
import type { DaySummary } from '../types';
import { IconChevronLeft, IconChevronRight } from './Icons';

type Props = {
  /** Выбранный день: с него открывается календарь. */
  selected: string;
  /** Дневная норма калорий. */
  target: number;
  /** Выбор дня — приложение переходит на него и закрывает календарь. */
  onPick: (iso: string) => void;
};

/** Порог нормы: +10% от цели. Ниже — зелёный день, выше — красный. */
const limitOf = (target: number): number => Math.round(target * 1.1);

type DayState = 'empty' | 'under' | 'over';

export function MonthCalendar({ selected, target, onPick }: Props) {
  const [month, setMonth] = useState(() => monthOf(selected));
  const [days, setDays] = useState<Record<string, DaySummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const limit = limitOf(target);
  const cells = useMemo(() => monthCells(month), [month]);

  // Выбранный день изменился снаружи — показываем тот месяц, где он находится.
  useEffect(() => {
    setMonth(monthOf(selected));
  }, [selected]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getMonth(month)
      .then((res) => {
        if (!alive) return;
        setDays(Object.fromEntries(res.days.map((d) => [d.day, d])));
        setError(null);
      })
      .catch(() => {
        if (!alive) return;
        setDays({});
        setError('Не удалось загрузить календарь.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [month]);

  const stateOf = (iso: string): DayState => {
    const d = days[iso];
    if (!d || d.entries === 0) return 'empty';
    return d.kcal > limit ? 'over' : 'under';
  };

  return (
    <>
      <div className="cal">
        <div className="cal__head">
          <button
            className="icon-btn"
            onClick={() => setMonth(shiftMonth(month, -1))}
            aria-label="Предыдущий месяц"
          >
            <IconChevronLeft size={18} />
          </button>
          <div className="cal__title">{monthLabel(month)}</div>
          <button
            className="icon-btn"
            onClick={() => setMonth(shiftMonth(month, 1))}
            aria-label="Следующий месяц"
          >
            <IconChevronRight size={18} />
          </button>
        </div>

        <div className="cal__weekdays">
          {CAL_WEEKDAYS.map((w) => (
            <span className="cal__weekday" key={w}>
              {w}
            </span>
          ))}
        </div>

        <div className="cal__grid" aria-busy={loading}>
          {cells.map((cell) => {
            const info = days[cell.iso];
            const state = cell.inMonth ? stateOf(cell.iso) : 'empty';
            const classes = ['cal__day', `cal__day--${state}`];
            if (!cell.inMonth) classes.push('is-out');
            if (cell.iso === selected) classes.push('is-selected');
            if (cell.iso > today()) classes.push('is-future');
            return (
              <button
                key={cell.iso}
                className={classes.join(' ')}
                onClick={() => onPick(cell.iso)}
                aria-label={`${cell.day} ${monthLabel(month)}${
                  info ? `, ${num(info.kcal)} ккал` : ', без записей'
                }`}
              >
                <span className="cal__daynum">{cell.day}</span>
                {info && <span className="cal__kcal">{num(info.kcal)}</span>}
              </button>
            );
          })}
        </div>

        {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
      </div>

      <div className="modal-footer-sticky">
        <button className="btn btn-soft w-100" onClick={() => onPick(today())}>
          Перейти к сегодняшнему дню
        </button>
      </div>
    </>
  );
}
