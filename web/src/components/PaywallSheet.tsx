
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { IconCheck } from './Icons';
import '../styles/paywall.css';

export type PaywallMode = 'quota' | 'feature' | 'plan';

type Props = { mode: PaywallMode };

type Plan = 'month' | 'year';

/** Контакт для отмены подписки и возврата - требование банка-эквайера. */
const SUPPORT_EMAIL = 'arsenijtam@gmail.com';

const rub = (kopecks: number): string => (kopecks / 100).toLocaleString('ru-RU') + ' \u20BD';

const TITLES: Record<PaywallMode, string> = {
  quota: 'Лимит фото исчерпан',
  feature: 'Это функция Plus',
  plan: 'BiteBalance Plus',
};

const DESCS: Record<PaywallMode, string> = {
  quota: 'Бесплатные распознавания блюд на этот период закончились. С Plus - до 50 в день.',
  feature: 'Эта возможность доступна только с подпиской Plus.',
  plan: 'Больше фото, история без срока - и поддержка развития сервиса.',
};

const PERKS: string[] = [
  'До 50 распознаваний блюд в день - по фото или описанию',
  'История дневника без ограничения 60 дней',
  'Отмена в один клик, доступ - до конца оплаченного периода',
];

export function PaywallSheet({ mode }: Props) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.billingStatus>> | null>(null);
  const [plan, setPlan] = useState<Plan>('year');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<Plan | null>(null);
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

  const prices = status ? status.prices : { month: 29900, year: 199000 };
  const amount = prices[plan];
  const monthly = Math.round(prices.year / 12 / 100) * 100;
  // Периодичность и сумма - прямо у кнопки: требование эквайринга.
  const periodLabel = plan === 'year' ? 'раз в 12 месяцев' : 'раз в месяц';
  const consentLabel = plan === 'year' ? 'каждые 12 месяцев' : 'каждый месяц';

  const buy = function () {
    if (!consent) return;
    setBusy(plan);
    setError(null);
    api
      .checkout(plan, true)
      .then(function (r) {
        window.location.href = r.paymentUrl;
      })
      .catch(function (err) {
        setBusy(null);
        setError(err instanceof ApiError ? err.message : 'Не удалось создать платёж.');
      });
  };

  return (
    <div className="paywall">
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

      {status && status.plus && <p className="paywall__active">Plus уже активен - приятного аппетита.</p>}
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="paywall__plans" role="radiogroup" aria-label="Тариф подписки">
        {(['year', 'month'] as Plan[]).map(function (p) {
          const active = plan === p;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={active}
              className={'paywall__plan' + (active ? ' is-on' : '')}
              onClick={function () {
                setPlan(p);
              }}
            >
              <span className="paywall__plan-head">
                <b>{p === 'year' ? 'Год' : 'Месяц'}</b>
                {p === 'year' && <span className="paywall__plan-badge">выгодно</span>}
              </span>
              <span className="paywall__plan-price">{rub(prices[p])}</span>
              <span className="paywall__plan-note">
                {p === 'year' ? 'раз в 12 месяцев · ' + rub(monthly) + ' в месяц' : 'раз в месяц'}
              </span>
            </button>
          );
        })}
      </div>

      <label className="paywall__consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={function (e) {
            setConsent(e.target.checked);
          }}
        />
        <span>
          Согласен на автоматические списания <b>{rub(amount)}</b> {consentLabel} до отмены подписки.
          Первое списание - {rub(amount)} сразу после оплаты.
        </span>
      </label>

      <button
        type="button"
        className="btn btn-primary btn-lg w-100"
        disabled={!consent || busy !== null}
        onClick={buy}
      >
        {busy ? 'Открываем банк…' : 'Оплатить ' + rub(amount) + ' ' + periodLabel}
      </button>

      <p className="paywall__legal">
        Отменить подписку можно в настройках приложения или письмом на{' '}
        <a href={'mailto:' + SUPPORT_EMAIL}>{SUPPORT_EMAIL}</a>. Возврат - по{' '}
        <a href="/legal/offer.html" target="_blank" rel="noreferrer">
          оферте
        </a>
        .
      </p>
    </div>
  );
}
