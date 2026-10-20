import { useState } from 'react';
import { api } from '../api';
import type { Settings } from '../types';
import { Sheet } from './Sheet';
import { IconMonitor, IconMoon, IconSun } from './Icons';

type Props = {
  settings: Settings;
  onSaved: (settings: Settings) => void;
  onClose: () => void;
};

type Draft = {
  kcal: string;
  protein: string;
  fat: string;
  carbs: string;
  theme: Settings['theme'];
};

export function SettingsSheet({ settings, onSaved, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>({
    kcal: String(settings.kcal),
    protein: String(settings.protein),
    fat: String(settings.fat),
    carbs: String(settings.carbs),
    theme: settings.theme,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const valid =
    Number(draft.kcal) >= 500 &&
    Number(draft.kcal) <= 10000 &&
    Number(draft.protein) >= 0 &&
    Number(draft.fat) >= 0 &&
    Number(draft.carbs) >= 0;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.updateSettings({
        kcal: Number(draft.kcal),
        protein: Number(draft.protein),
        fat: Number(draft.fat),
        carbs: Number(draft.carbs),
        theme: draft.theme,
      });
      onSaved(saved);
    } catch {
      setError('Не удалось сохранить настройки.');
    } finally {
      setBusy(false);
    }
  };

  const themes: [Settings['theme'], string, React.ReactNode][] = [
    ['auto', 'Авто', <IconMonitor key="a" size={18} />],
    ['light', 'Светлая', <IconSun key="l" size={18} />],
    ['dark', 'Тёмная', <IconMoon key="d" size={18} />],
  ];

  return (
    <Sheet title="Настройки" onClose={onClose}>
      <section className="settings-section">
        <span className="label">Дневная норма</span>
        <div className="grid-4" style={{ marginTop: 12 }}>
          <div>
            <label className="field-label" htmlFor="s-kcal">
              Ккал
            </label>
            <input
              id="s-kcal"
              className="field"
              type="number"
              inputMode="numeric"
              value={draft.kcal}
              onChange={(e) => set('kcal')(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="s-protein">
              Белки
            </label>
            <input
              id="s-protein"
              className="field"
              type="number"
              inputMode="numeric"
              value={draft.protein}
              onChange={(e) => set('protein')(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="s-fat">
              Жиры
            </label>
            <input
              id="s-fat"
              className="field"
              type="number"
              inputMode="numeric"
              value={draft.fat}
              onChange={(e) => set('fat')(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="s-carbs">
              Углеводы
            </label>
            <input
              id="s-carbs"
              className="field"
              type="number"
              inputMode="numeric"
              value={draft.carbs}
              onChange={(e) => set('carbs')(e.target.value)}
            />
          </div>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Значения белков, жиров и углеводов — в граммах на день.
        </p>
      </section>

      <section className="settings-section">
        <span className="label">Оформление</span>
        <div className="theme-picker" style={{ marginTop: 12 }}>
          {themes.map(([key, label, icon]) => (
            <button
              key={key}
              className="theme-option"
              aria-pressed={draft.theme === key}
              onClick={() => set('theme')(key)}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="notice notice--danger" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      <button
        className="btn btn--block btn--lg"
        style={{ marginTop: 20 }}
        disabled={!valid || busy}
        onClick={() => void save()}
      >
        {busy ? (
          <>
            <span className="spinner" />
            Сохраняем…
          </>
        ) : (
          'Сохранить настройки'
        )}
      </button>
    </Sheet>
  );
}
