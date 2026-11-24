import { useMemo, useState } from 'react';
import { IconChevronLeft } from './Icons';

export type OnboardingTargets = {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
};

type Goal = 'lose' | 'keep' | 'gain';
type Sex = 'f' | 'm';

const GOALS: Array<{ id: Goal; title: string; hint: string }> = [
  { id: 'lose', title: 'Похудеть', hint: 'мягкий дефицит, минус 15%' },
  { id: 'keep', title: 'Держать вес', hint: 'норма без поправок' },
  { id: 'gain', title: 'Набрать', hint: 'профицит, плюс 10%' },
];

const ACTIVITIES: Array<{ value: number; label: string }> = [
  { value: 1.2, label: 'Сидячая' },
  { value: 1.375, label: '1-2 тренировки' },
  { value: 1.55, label: '3-5 тренировок' },
  { value: 1.725, label: 'Каждый день' },
];

/** Иконки целей: вниз, в обе стороны, вверх. */
const GoalIcon = ({ goal }: { goal: Goal }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"
       stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    {goal === 'lose' && <path d="M12 5v14M6 13l6 6 6-6" />}
    {goal === 'keep' && <path d="M4 12h16M9 7l-5 5 5 5M15 7l5 5-5 5" />}
    {goal === 'gain' && <path d="M12 19V5M6 11l6-6 6 6" />}
  </svg>
);

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

type Props = {
  /** Сохраняет норму и закрывает онбординг. */
  onDone: (targets: OnboardingTargets) => Promise<void>;
};

/**
 * Первый запуск: три вопроса и проверка нормы. Показывается один раз,
 * пока в настройках не отмечено, что знакомство пройдено.
 */
export function Onboarding({ onDone }: Props) {
  const [step, setStep] = useState(1);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [sex, setSex] = useState<Sex>('f');
  const [age, setAge] = useState(29);
  const [height, setHeight] = useState(168);
  const [weight, setWeight] = useState(62);
  const [activity, setActivity] = useState(1.375);
  const [manual, setManual] = useState<OnboardingTargets | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const computed = useMemo<OnboardingTargets>(() => {
    const bmr = 10 * weight + 6.25 * height - 5 * age + (sex === 'm' ? 5 : -161);
    const tdee = bmr * activity;
    const factor = goal === 'lose' ? 0.85 : goal === 'gain' ? 1.1 : 1;
    const min = sex === 'm' ? 1500 : 1200;
    const kcal = Math.max(min, Math.round((tdee * factor) / 10) * 10);
    const protein = Math.round(weight * 1.7);
    const fat = Math.round(weight * 0.9);
    const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
    return { kcal, protein, fat, carbs };
  }, [weight, height, age, sex, activity, goal]);

  const norm = manual ?? computed;

  const next = async () => {
    if (step === 1) {
      setStep(2);
      return;
    }
    if (step === 2) {
      setManual(null);
      setStep(3);
      return;
    }
    setBusy(true);
    try {
      await onDone(norm);
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    if (step === 1) return;
    setStep(step - 1);
  };

  const editManual = (patch: Partial<OnboardingTargets>) => {
    const nextValue = { ...norm, ...patch };
    setManual({
      kcal: clamp(nextValue.kcal, 800, 6000),
      protein: clamp(nextValue.protein, 0, 400),
      fat: clamp(nextValue.fat, 0, 300),
      carbs: clamp(nextValue.carbs, 0, 700),
    });
  };

  return (
    <div className="onb">
      <div className="onb__backdrop" />
      <div className="onb__card" role="dialog" aria-modal="true" aria-labelledby="onb-title">
        <div className="onb__head">
          <div className="onb__progress" aria-hidden="true">
            {[1, 2, 3].map((i) => (
              <i key={i} className={i <= step ? 'is-on' : ''} />
            ))}
          </div>
        </div>

        <div className="onb__body">
          {step === 1 && (
            <>
              <h2 className="onb__title" id="onb-title">Какая у вас цель?</h2>
              <p className="onb__hint">От этого зависит норма и тон подсказок</p>
              <div className="onb__goals">
                {GOALS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={'onb__goal' + (goal === g.id ? ' is-on' : '')}
                    onClick={() => setGoal(g.id)}
                  >
                    <span className="onb__goal-ico"><GoalIcon goal={g.id} /></span>
                    <span className="onb__goal-txt">
                      <b>{g.title}</b>
                      <small>{g.hint}</small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="onb__title" id="onb-title">Пара цифр для нормы</h2>
              <p className="onb__hint">Нужны один раз. Всё можно поменять в настройках</p>

              <div className="onb__label">Пол</div>
              <div className="onb__seg" role="group" aria-label="Пол">
                <button type="button" className={sex === 'f' ? 'is-on' : ''} onClick={() => setSex('f')}>Женский</button>
                <button type="button" className={sex === 'm' ? 'is-on' : ''} onClick={() => setSex('m')}>Мужской</button>
              </div>

              <div className="onb__row">
                <label className="onb__field">
                  <span>Возраст</span>
                  <input
                    type="number" inputMode="numeric" min={14} max={90} value={age}
                    onChange={(e) => setAge(clamp(Number(e.target.value) || 0, 14, 90))}
                  />
                  <i>лет</i>
                </label>
                <label className="onb__field">
                  <span>Рост</span>
                  <input
                    type="number" inputMode="numeric" min={120} max={220} value={height}
                    onChange={(e) => setHeight(clamp(Number(e.target.value) || 0, 120, 220))}
                  />
                  <i>см</i>
                </label>
              </div>

              <label className="onb__field">
                <span>Вес</span>
                <input
                  type="number" inputMode="numeric" min={30} max={250} value={weight}
                  onChange={(e) => setWeight(clamp(Number(e.target.value) || 0, 30, 250))}
                />
                <i>кг</i>
              </label>

              <div className="onb__label">Активность</div>
              <div className="onb__chips">
                {ACTIVITIES.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    className={activity === a.value ? 'is-on' : ''}
                    onClick={() => setActivity(a.value)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              <div className="onb__preview">
                <span>Ваша норма</span>
                <b>{fmt(computed.kcal)} ккал</b>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="onb__title" id="onb-title">Проверьте норму</h2>
              <p className="onb__hint">Если цифра не нравится, поправьте вручную</p>

              <div className="onb__norm">
                <b>{fmt(norm.kcal)}</b>
                <span>ккал в день</span>
              </div>

              <div className="onb__macros">
                <div><span>Белки</span><b>{norm.protein} г</b></div>
                <div><span>Жиры</span><b>{norm.fat} г</b></div>
                <div><span>Углеводы</span><b>{norm.carbs} г</b></div>
              </div>

              <button type="button" className="onb__link" onClick={() => setManualOpen((v) => !v)}>
                {manualOpen ? 'Скрыть ручную настройку' : 'Поправить вручную'}
              </button>

              {manualOpen && (
                <div className="onb__manual">
                  <div className="onb__row">
                    <label className="onb__field">
                      <span>Калории</span>
                      <input
                        type="number" inputMode="numeric" value={norm.kcal}
                        onChange={(e) => editManual({ kcal: Number(e.target.value) || 0 })}
                      />
                      <i>ккал</i>
                    </label>
                    <label className="onb__field">
                      <span>Белки</span>
                      <input
                        type="number" inputMode="numeric" value={norm.protein}
                        onChange={(e) => editManual({ protein: Number(e.target.value) || 0 })}
                      />
                      <i>г</i>
                    </label>
                  </div>
                  <div className="onb__row">
                    <label className="onb__field">
                      <span>Жиры</span>
                      <input
                        type="number" inputMode="numeric" value={norm.fat}
                        onChange={(e) => editManual({ fat: Number(e.target.value) || 0 })}
                      />
                      <i>г</i>
                    </label>
                    <label className="onb__field">
                      <span>Углеводы</span>
                      <input
                        type="number" inputMode="numeric" value={norm.carbs}
                        onChange={(e) => editManual({ carbs: Number(e.target.value) || 0 })}
                      />
                      <i>г</i>
                    </label>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="onb__foot">
          {step > 1 && (
            <button type="button" className="btn btn-outline-secondary" onClick={back} aria-label="Назад">
              <IconChevronLeft />
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary flex-grow-1"
            onClick={() => void next()}
            disabled={busy || (step === 1 && !goal)}
          >
            {step === 3 ? (busy ? 'Сохраняем…' : 'Готово') : 'Дальше'}
          </button>
        </div>
      </div>
    </div>
  );
}
