import { num } from '../lib/format';
import type { Nutrition, Targets } from '../types';

type Props = {
  totals: Nutrition;
  targets: Targets;
};

const MACROS = [
  { key: 'protein', name: 'Белок', color: 'var(--protein)' },
  { key: 'fat', name: 'Жиры', color: 'var(--fat)' },
  { key: 'carbs', name: 'Углеводы', color: 'var(--carbs)' },
] as const;

export function MacroList({ totals, targets }: Props) {
  return (
    <div className="macros">
      {MACROS.map((m) => {
        const value = totals[m.key];
        const target = targets[m.key] || 1;
        const pct = Math.min((value / target) * 100, 100);
        return (
          <div key={m.key}>
            <div className="macro__head">
              <span className="macro__name">{m.name}</span>
              <span className="macro__value">
                <b>{num(value, 1)}</b> / {num(target)} г
              </span>
            </div>
            <div className="bar">
              <i style={{ width: `${pct}%`, background: m.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
