import { dayNumber, weekdayShort } from '../lib/date';
import type { WeekDay } from '../types';

type Props = {
  days: WeekDay[];
  selected: string;
  target: number;
  onSelect: (date: string) => void;
};

export function WeekStrip({ days, selected, target, onSelect }: Props) {
  const safeTarget = target > 0 ? target : 1;
  const todayIso = new Date().toLocaleDateString('sv-SE');

  return (
    <section className="card week" aria-label="Калории за неделю">
      <div className="week__title">
        <span className="label">Неделя</span>
        <span className="hint">{days.length ? 'нажмите на день' : ''}</span>
      </div>
      <div className="week__grid">
        {days.map((d) => {
          const pct = Math.min(d.kcal / safeTarget, 1);
          const over = d.kcal > safeTarget;
          return (
            <button
              key={d.date}
              className={`week__day${d.date === selected ? ' is-selected' : ''}${
                d.date === todayIso ? ' is-today' : ''
              }`}
              onClick={() => onSelect(d.date)}
              title={`${d.date}: ${d.kcal} ккал`}
            >
              <span className="week__dow">{weekdayShort(d.date)}</span>
              <span className="week__track">
                <span
                  className={`week__fill${over ? ' is-over' : ''}${d.kcal === 0 ? ' is-empty' : ''}`}
                  style={{ height: `${Math.max(d.kcal > 0 ? 8 : 0, pct * 100)}%` }}
                />
              </span>
              <span className="week__num">{dayNumber(d.date)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
