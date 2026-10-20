import { num } from '../lib/format';

type Props = {
  kcal: number;
  target: number;
};

const R = 96;
const C = 2 * Math.PI * R;

export function CalorieRing({ kcal, target }: Props) {
  const safeTarget = target > 0 ? target : 1;
  const ratio = Math.min(kcal / safeTarget, 1);
  const over = kcal > safeTarget;
  const left = Math.max(0, safeTarget - kcal);

  return (
    <div className="ring">
      <svg viewBox="0 0 212 212" aria-hidden="true">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={over ? '#f0736a' : '#4ec27f'} />
            <stop offset="100%" stopColor={over ? '#d4483f' : '#2f9e5f'} />
          </linearGradient>
        </defs>
        <circle className="ring__track" cx="106" cy="106" r={R} fill="none" strokeWidth="15" />
        <circle
          className="ring__arc"
          cx="106"
          cy="106"
          r={R}
          fill="none"
          stroke="url(#ringGrad)"
          strokeWidth="15"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - ratio)}
        />
      </svg>
      <div className="ring__center">
        <div className={`ring__value${over ? ' is-over' : ''}`}>{num(kcal)}</div>
        <div className="ring__goal">из {num(target)} ккал</div>
      </div>
    </div>
  );
}
