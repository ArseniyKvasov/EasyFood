import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Settings, User } from '../types';
import { IconLogout, IconMail, IconMonitor, IconMoon, IconSun } from './Icons';

/** Почта поддержки. Перекрывается сборкой: VITE_SUPPORT_EMAIL. */
const SUPPORT_EMAIL: string =
  (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) || 'arsenijtam@gmail.com';

type Props = {
  settings: Settings;
  /** Аккаунт, под которым открыт дневник. */
  user: User | null;
  onLogout: () => void;
  onSaved: (settings: Settings) => void;
  onPaywall: () => void;
};

type Billing = Awaited<ReturnType<typeof api.billingStatus>> | null;

const fmtDate = (iso: string | null): string => {
  if (!iso) return '';
  const d = iso.slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : iso.slice(0, 10);
};

type Draft = {
  kcal: string;
  protein: string;
  fat: string;
  carbs: string;
  theme: Settings['theme'];
};

export function SettingsSheet({ settings, user, onLogout, onSaved, onPaywall }: Props) {
  const [billing, setBilling] = useState<Billing>(null);
  const [billingMsg, setBillingMsg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .billingStatus()
      .then((s) => {
        if (alive) setBilling(s);
      })
      .catch(() => {
        if (alive) setBilling(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  const cancelSub = async () => {
    if (!window.confirm('Отключить автопродление? Доступ Plus сохранится до конца оплаченного периода.')) return;
    setBillingMsg(null);
    try {
      const r = await api.cancelSubscription();
      setBilling((b) => (b ? { ...b, cancel_at: r.current_end } : b));
      setBillingMsg('Автопродление отключено.');
    } catch {
      setBillingMsg('Не удалось отменить подписку.');
    }
  };
  const [draft, setDraft] = useState<Draft>({
    kcal: String(settings.kcal),
    protein: String(settings.protein),
    fat: String(settings.fat),
    carbs: String(settings.carbs),
    theme: settings.theme,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Портрет лежит на avatars.yandex.net: если он не загрузился, показываем букву.
  const [avatarFailed, setAvatarFailed] = useState(false);

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

  const initial =
    (user?.displayName || user?.login || '').trim().charAt(0).toUpperCase() || 'Я';

  return (
    <>
      {user && (
        <section className="settings-section">
          <span className="bb-label">Аккаунт</span>
          <div className="account">
            {user.avatarUrl && !avatarFailed ? (
              <img
                className="account__avatar"
                src={user.avatarUrl}
                alt=""
                width={44}
                height={44}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span className="account__avatar account__avatar--initial" aria-hidden="true">
                {initial}
              </span>
            )}
            <div className="account__text">
              <div className="account__name">{user.displayName || user.login || 'Яндекс ID'}</div>
              <div className="account__meta">
                {user.login ? `Яндекс ID · ${user.login}` : 'Яндекс ID'}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-outline-secondary w-100 mt-3 account__logout"
            onClick={onLogout}
          >
            <IconLogout size={17} />
            Выйти из аккаунта
          </button>
        </section>
      )}

      <section className="settings-section">
        <span className="bb-label">Подписка</span>
        <div className="account mt-2">
          <div className="account__text">
            <div className="account__name">
              {billing ? (billing.plus ? 'Plus' : 'Free') : '…'}
              {billing?.cancel_at && (
                <span className="text-muted"> · до {fmtDate(billing.current_end)}</span>
              )}
              {!billing?.cancel_at && billing?.current_end && billing.plus && (
                <span className="text-muted"> · до {fmtDate(billing.current_end)}</span>
              )}
            </div>
            <div className="account__meta">
              {billing
                ? billing.quota.plus
                  ? `Фото сегодня: ${billing.quota.used} из ${billing.quota.limit}`
                  : `Фото в этом месяце: ${billing.quota.used} из ${billing.quota.limit}`
                : 'Загружаем тариф…'}
            </div>
          </div>
        </div>
        {billingMsg && <div className="alert alert-info mt-2 mb-0">{billingMsg}</div>}
        {billing && !billing.plus && (
          <button type="button" className="btn btn-primary w-100 mt-2" onClick={onPaywall}>
            Оформить Plus
          </button>
        )}
        {billing?.cancel_at && (
          <p className="hint mt-2 mb-0">Автопродление отключено.</p>
        )}
        {billing && billing.plus && !billing.cancel_at && billing.plan !== 'manual' && (
          <button
            type="button"
            className="btn btn-outline-secondary w-100 mt-2"
            onClick={() => void cancelSub()}
          >
            Отключить автопродление
          </button>
        )}
      </section>

      <section className="settings-section">
        <span className="bb-label">Дневная норма</span>
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
          Белки, жиры и углеводы - в граммах на день.
        </p>
      </section>

      <section className="settings-section">
        <span className="bb-label">Оформление</span>
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

      <section className="settings-section">
        <span className="bb-label">Помощь</span>
        <a
          className="btn btn-outline-secondary w-100 mt-2"
          href={`mailto:${SUPPORT_EMAIL}?subject=BiteBalance - вопрос в поддержку`}
        >
          <IconMail size={17} />
          Написать в поддержку
        </a>
        <p className="hint mt-2 mb-0">Ответим на {SUPPORT_EMAIL} в течение пары дней.</p>
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
    </>
  );
}
