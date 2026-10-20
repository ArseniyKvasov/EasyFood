import { useState } from 'react';
import { api } from '../api';
import type { Settings } from '../types';
import { IconMonitor, IconMoon, IconSun } from './Icons';

type Props = {
  settings: Settings;
  username: string;
  onSaved: (settings: Settings) => void;
  onLogout: () => void;
};

type Draft = {
  kcal: string;
  protein: string;
  fat: string;
  carbs: string;
  theme: Settings['theme'];
};

export function SettingsSheet({ settings, username, onSaved, onLogout }: Props) {
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
    <>
      <section className="settings-section">
        <span className="ef-label">Дневная норма</span>
        <div className="row g-2 mt-1">
          <div className="col-3">
            <label className="form-label" htmlFor="s-kcal">
              Ккал
            </label>
            <input
              id="s-kcal"
              className="form-control text-center"
              type="number"
              inputMode="numeric"
              value={draft.kcal}
              onChange={(e) => set('kcal')(e.target.value)}
            />
          </div>
          <div className="col-3">
            <label className="form-label" htmlFor="s-protein">
              Белки
            </label>
            <input
              id="s-protein"
              className="form-control text-center"
              type="number"
              inputMode="numeric"
              value={draft.protein}
              onChange={(e) => set('protein')(e.target.value)}
            />
          </div>
          <div className="col-3">
            <label className="form-label" htmlFor="s-fat">
              Жиры
            </label>
            <input
              id="s-fat"
              className="form-control text-center"
              type="number"
              inputMode="numeric"
              value={draft.fat}
              onChange={(e) => set('fat')(e.target.value)}
            />
          </div>
          <div className="col-3">
            <label className="form-label" htmlFor="s-carbs">
              Углеводы
            </label>
            <input
              id="s-carbs"
              className="form-control text-center"
              type="number"
              inputMode="numeric"
              value={draft.carbs}
              onChange={(e) => set('carbs')(e.target.value)}
            />
          </div>
        </div>
        <p className="hint mt-2 mb-0">
          Белки, жиры и углеводы — в граммах на день.
        </p>
      </section>

      <section className="settings-section">
        <span className="ef-label">Оформление</span>
        <div className="theme-picker mt-2">
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

      {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}

      <button
        className="btn btn-primary btn-lg w-100 mt-4"
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

      <section className="settings-section">
        <span className="ef-label">Аккаунт</span>
        <div className="d-flex align-items-center justify-content-between gap-3 mt-2">
          <div>
            <div style={{ fontWeight: 600 }}>{username}</div>
            <div className="hint">Вход по логину и паролю</div>
          </div>
          <button className="btn btn-outline-secondary" onClick={onLogout}>
            Выйти
          </button>
        </div>
      </section>
    </>
  );
}
