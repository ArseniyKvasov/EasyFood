
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';

export type PaywallMode = 'quota' | 'feature' | 'plan';

type Props = { mode: PaywallMode };

const SUPPORT_EMAIL = 'arsenijtam@gmail.com';

const rub = (kopecks: number): string => (kopecks / 100).toLocaleString('ru-RU') + ' \u20BD';

const TITLES: Record<PaywallMode, string> = {
  quota: 'Лимит фото исчерпан',
  feature: 'Это функция Plus',
  plan: 'BiteBalance Plus',
};

const DESCS: Record<PaywallMode, string> = {
  quota: 'Бесплатные распознавания на этот период закончились. С Plus — до 50 фото в день.',
  feature: 'Эта возможность доступна только с подпиской Plus.',
  plan: 'Больше фото, история без срока — и поддержка развития сервиса.',
};

export function PaywallSheet({ mode }: Props) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.billingStatus>> | null>(null);
  const [busy, setBusy] = useState<'month' | 'year' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(function () {
    let alive = true;
    api
      .billingStatus()
      .then(function (s) {
        if (alive) setStatus(s);
      })
      .catch(function () {
        if (alive) setStatus(null);
      });
    return function () {
      alive = false;
    };
  }, []);

  const buy = function (plan: 'month' | 'year') {
    setBusy(plan);
    setError(null);
    api
      .checkout(plan)
      .then(function (r) {
        window.location.href = r.paymentUrl;
      })
      .catch(function (err) {
        setBusy(null);
        setError(err instanceof ApiError ? err.message : 'Не удалось создать платёж.');
      });
  };

  const month = status ? status.prices.month : 29900;
  const year = status ? status.prices.year : 199000;

  return (
    <div className="paywall">
      <h3 className="mb-1">{TITLES[mode]}</h3>
      <p className="text-muted">{DESCS[mode]}</p>
      <ul className="paywall__list">
        <li>До 50 распознаваний по фото в день</li>
        <li>История дневника без ограничения 60 дней</li>
        <li>Отмена в один клик, доступ — до конца оплаченного периода</li>
      </ul>
      {status && status.plus && (
        <div className="alert alert-success">Plus уже активен — приятного аппетита.</div>
      )}
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="d-grid gap-2">
        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={busy !== null}
          onClick={function () {
            void buy('year');
          }}
        >
          {busy === 'year' ? 'Открываем банк…' : 'Год · ' + rub(year) + ' (≈' + Math.round(year / 12 / 100) + ' \u20BD/мес)'}
        </button>
        <button
          type="button"
          className="btn btn-outline-primary btn-lg"
          disabled={busy !== null}
          onClick={function () {
            void buy('month');
          }}
        >
          {busy === 'month' ? 'Открываем банк…' : 'Месяц · ' + rub(month)}
        </button>
      </div>
      <p className="hint mt-3 mb-0">
        Оплата через Т-Банк, автопродление. За 3 дня до списания предупредим письмом и push.
        Условия — в{' '}
        <a href="/legal/offer.html" target="_blank" rel="noreferrer">
          оферте
        </a>
        , вопросы — на {SUPPORT_EMAIL}.
      </p>
    </div>
  );
}
