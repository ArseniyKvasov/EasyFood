
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { IconCheck } from './Icons';

export type PaywallMode = 'quota' | 'feature' | 'plan';

type Props = { mode: PaywallMode };

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

const PERKS: string[] = [
  'До 50 распознаваний по фото в день',
  'История дневника без ограничения 60 дней',
  'Отмена в один клик, доступ — до конца оплаченного периода',
];

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
      <p className="bb-label">BiteBalance Plus</p>
      <h3 className="paywall__title">{TITLES[mode]}</h3>
      <p className="paywall__desc">{DESCS[mode]}</p>
      <ul className="paywall__list">
        {PERKS.map(function (perk) {
          return (
            <li key={perk}>
              <span className="paywall__check" aria-hidden="true">
                <IconCheck size={15} />
              </span>
              {perk}
            </li>
          );
        })}
      </ul>
      {status && status.plus && (
        <p className="paywall__active">Plus уже активен — приятного аппетита.</p>
      )}
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="d-grid gap-2">
        <button
          type="button"
          className="btn btn-primary btn-lg w-100 paywall__cta"
          disabled={busy !== null}
          onClick={function () {
            void buy('year');
          }}
        >
          <span>Год · {rub(year)}</span>
          <small>≈{Math.round(year / 12 / 100)} ₽/мес · выгодно</small>
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-lg w-100"
          disabled={busy !== null}
          onClick={function () {
            void buy('month');
          }}
        >
          {busy === 'month' ? 'Открываем банк…' : 'Месяц · ' + rub(month)}
        </button>
      </div>
      {busy === 'year' && <p className="hint mt-2 mb-0">Открываем банк…</p>}
    </div>
  );
}
