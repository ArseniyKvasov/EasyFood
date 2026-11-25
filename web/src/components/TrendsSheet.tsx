
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { PaywallSheet } from './PaywallSheet';

type Props = { onPaywall: () => void };

type Metric = 'kcal' | 'protein' | 'fat' | 'carbs';

type Trends = Awaited<ReturnType<typeof api.trends>>;

const METRICS: { key: Metric; name: string }[] = [
  { key: 'kcal', name: 'Ккал' },
  { key: 'protein', name: 'Белки' },
  { key: 'fat', name: 'Жиры' },
  { key: 'carbs', name: 'Углеводы' },
];

const PRESETS = [30, 60, 90];

const num = (v: number): string => v.toLocaleString('ru-RU');

export function TrendsSheet({ onPaywall }: Props) {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<Metric>('kcal');
  const [data, setData] = useState<Trends | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState<'csv' | null>(null);

  useEffect(function () {
    let alive = true;
    setData(null);
    setLocked(false);
    api
      .trends(days)
      .then(function (t) {
        if (alive) setData(t);
      })
      .catch(function (err) {
        if (!alive) return;
        if (err instanceof ApiError && (err.code === 'PLUS_REQUIRED' || err.status === 402)) setLocked(true);
      });
    return function () {
      alive = false;
    };
  }, [days]);

  if (locked) return <PaywallSheet mode="feature" />;

  const exportCsv = function () {
    if (!data) return;
    setBusy('csv');
    api
      .exportCsv(data.from, data.to)
      .catch(function (err) {
        if (err instanceof ApiError && (err.code === 'PLUS_REQUIRED' || err.status === 402)) onPaywall();
      })
      .finally(function () {
        setBusy(null);
      });
  };

  const openPrint = function () {
    if (!data) return;
    window.open('/app/print?from=' + data.from + '&to=' + data.to, '_blank', 'noopener');
  };

  const values = data ? data.days.map(function (d) { return d[metric]; }) : [];
  const target = data ? data.targets[metric] : 0;
  const max = Math.max.apply(null, [target, 10].concat(values));
  const H = 160;
  const STEP = 14;
  const BW = 8;
  const W = Math.max(300, (data ? data.days.length : 0) * STEP);
  const y = function (v: number): number { return H - 18 - (v / max) * (H - 30); };

  return (
    <div>
      <div className="d-flex gap-2 flex-wrap mb-3">
        {PRESETS.map(function (p) {
          return (
            <button
              key={p}
              className={'btn btn-sm ' + (days === p ? 'btn-primary' : 'btn-outline-secondary')}
              onClick={function () { setDays(p); }}
            >
              {p} дн.
            </button>
          );
        })}
        <div className="btn-group btn-group-sm ms-auto" role="group" aria-label="Метрика">
          {METRICS.map(function (m) {
            return (
              <button
                key={m.key}
                className={'btn ' + (metric === m.key ? 'btn-secondary' : 'btn-outline-secondary')}
                onClick={function () { setMetric(m.key); }}
              >
                {m.name}
              </button>
            );
          })}
        </div>
      </div>

      {!data && <div className="admin-loading">Считаем тренды…</div>}

      {data && (
        <div>
          <div className="row g-2 mb-3">
            <div className="col-4">
              <div className="card admin-stat"><div className="admin-stat-value">{num(data.summary.avgKcal)}</div><div className="admin-stat-label">Средне ккал/день</div></div>
            </div>
            <div className="col-4">
              <div className="card admin-stat"><div className="admin-stat-value">{data.summary.streak}</div><div className="admin-stat-label">Дней подряд</div></div>
            </div>
            <div className="col-4">
              <div className="card admin-stat"><div className="admin-stat-value">{data.summary.inNormDays}/{data.summary.activeDays}</div><div className="admin-stat-label">Дней в норме</div></div>
            </div>
          </div>

          <div className="card p-2 mb-3">
            <div style={{ overflowX: 'auto' }}>
              <svg width={W} height={H} role="img" aria-label="Динамика">
                <line x1="0" y1={y(target)} x2={W} y2={y(target)} stroke="#2f6b4f" strokeDasharray="5 4" strokeWidth="1.5" />
                <text x={W - 4} y={y(target) - 4} textAnchor="end" fontSize="10" fill="#2f6b4f">норма {num(target)}</text>
                {data.days.map(function (d, i) {
                  const v = d[metric];
                  const over = metric === 'kcal' ? v > data.targets.kcal * 1.1 : false;
                  const h = Math.max(v > 0 ? 3 : 1, (v / max) * (H - 30));
                  return (
                    <g key={d.day}>
                      <title>{d.day}: {num(v)}</title>
                      <rect
                        x={i * STEP + 2}
                        y={H - 18 - h}
                        width={BW}
                        height={h}
                        rx={2}
                        fill={v === 0 ? '#e3e7e4' : over ? '#e8735a' : '#2f6b4f'}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="text-muted small mt-1">
              {data.from} — {data.to} · красное — перебор калорий (&gt;110% нормы)
            </div>
          </div>

          <div className="card p-3 mb-3">
            <div className="small text-muted">Среднее в активные дни</div>
            <div className="d-flex gap-3 flex-wrap mt-1">
              <span>Ккал <b>{num(data.summary.avgKcal)}</b></span>
              <span>Б <b>{num(data.summary.avgProtein)}</b></span>
              <span>Ж <b>{num(data.summary.avgFat)}</b></span>
              <span>У <b>{num(data.summary.avgCarbs)}</b></span>
            </div>
          </div>

          <div className="d-grid gap-2">
            <button type="button" className="btn btn-outline-primary" disabled={busy !== null} onClick={exportCsv}>
              {busy === 'csv' ? 'Готовим файл…' : 'Скачать CSV (' + data.from + ' — ' + data.to + ')'}
            </button>
            <button type="button" className="btn btn-outline-secondary" onClick={openPrint}>
              Отчёт для печати / PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
