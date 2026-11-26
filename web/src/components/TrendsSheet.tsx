
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { PaywallSheet } from './PaywallSheet';
import { IconChart, IconDownload, IconPrint } from './Icons';
import '../styles/trends.css';

type Props = { onPaywall: () => void };

type Metric = 'kcal' | 'protein' | 'fat' | 'carbs';
type Trends = Awaited<ReturnType<typeof api.trends>>;

const METRICS: { key: Metric; short: string; name: string; unit: string }[] = [
  { key: 'kcal', short: 'Ккал', name: 'Калории', unit: 'ккал' },
  { key: 'protein', short: 'Белки', name: 'Белки', unit: 'г' },
  { key: 'fat', short: 'Жиры', name: 'Жиры', unit: 'г' },
  { key: 'carbs', short: 'Углев.', name: 'Углеводы', unit: 'г' },
];

const PERIODS = [30, 60, 90];

const num = (v: number): string => Math.round(v).toLocaleString('ru-RU');
const num1 = (v: number): string => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toLocaleString('ru-RU');
};
const shortDay = (iso: string): string => iso.slice(8, 10) + '.' + iso.slice(5, 7);
const longDay = (iso: string): string => iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);

/**
 * Наблюдает за самим скроллером: его ширина — база для масштаба графика.
 * Один источник правды: и ширина, и позиция скролла обновляются на каждый
 * ресайз, поэтому график не «прыгает» при первом открытии шторки.
 */
function useScroller(): [React.RefObject<HTMLDivElement | null>, number, () => void] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(300);
  const toEnd = (): void => {
    const node = ref.current;
    if (node) node.scrollLeft = node.scrollWidth - node.clientWidth;
  };
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const apply = (): void => {
      if (node.clientWidth > 0) setWidth(Math.round(node.clientWidth));
      node.scrollLeft = node.scrollWidth - node.clientWidth;
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  return [ref, width, toEnd];
}

/** Столбики по дням с линией нормы. Ширина — по контейнеру, много дней скроллится. */
function Chart(props: { data: Trends; metric: Metric }) {
  const { data, metric } = props;
  const [scrollRef, boxWidth, scrollToEnd] = useScroller();
  const found = METRICS.find((m) => m.key === metric)!;
  const values = data.days.map((d) => d[metric]);
  const target = data.targets[metric];
  const max = Math.max(target, 1, ...values) * 1.1;
  const days = data.days.length;
  const minStep = 6;
  const step = Math.max(minStep, boxWidth / days);
  const width = Math.round(step * days);
  const barW = Math.max(3, Math.min(16, step - Math.max(2, step * 0.28)));
  const height = 184;
  const top = 26;
  const bottom = 24;
  const plot = height - top - bottom;
  const y = (v: number): number => top + plot - (v / max) * plot;
  const overLimit = metric === 'kcal' ? data.targets.kcal * 1.1 : Infinity;
  const gridLines = [0.5, 1].map((k) => Math.round(max * k));

  // Подписи дат: шаг такой, чтобы соседние не слипались, последний день всегда виден.
  const tickEvery = Math.max(1, Math.ceil(46 / step));
  const lastIndex = days - 1;
  const showTick = (i: number): boolean =>
    i === lastIndex || (i % tickEvery === 0 && lastIndex - i >= tickEvery * 0.6);

  // При 60–90 днях график шире экрана: показываем свежие дни, а не пустое начало.
  // SVG получает ширину не в тот же кадр, что контейнер, поэтому доводим
  // позицию несколько кадров подряд — иначе скролл остаётся в начале.
  useEffect(() => {
    let frame = 0;
    let raf = 0;
    const step = (): void => {
      scrollToEnd();
      frame += 1;
      if (frame < 12) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [width, days]);

  const targetY = y(target);

  // 7-дневное среднее: сглаживает разброс и показывает тренд.
  const rolling = data.days.map((_, i) => {
    const slice = data.days.slice(Math.max(0, i - 6), i + 1).filter((x) => x.entries > 0);
    if (!slice.length) return null;
    const sum = slice.reduce((s, x) => s + x[metric], 0);
    return sum / slice.length;
  });
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  rolling.forEach((v, i) => {
    if (v === null) {
      if (current.length > 1) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: i * step + step / 2, y: y(v) });
  });
  if (current.length > 1) segments.push(current);

  return (
    <div className="tr__chart">
      <div className="tr__chart-scroll" ref={scrollRef}>
        <svg width={width} height={height} role="img" aria-label={'Динамика: ' + found.name}>
          {gridLines.map((g) => (
            <line key={g} x1="0" x2={width} y1={y(g)} y2={y(g)} className="tr__grid" />
          ))}
          <line x1="0" x2={width} y1={top + plot} y2={top + plot} className="tr__axis" />

          {data.days.map((d, i) => {
            const v = d[metric];
            const has = d.entries > 0;
            const h = has ? Math.max(3, (v / max) * plot) : 0;
            const over = has && v > overLimit;
            const x = i * step + (step - barW) / 2;
            return (
              <g key={d.day}>
                <title>{longDay(d.day)}: {has ? num1(v) + ' ' + found.unit : 'нет записей'}</title>
                {has ? (
                  <rect
                    x={x}
                    y={top + plot - h}
                    width={barW}
                    height={h}
                    rx={Math.min(3, barW / 2)}
                    className={over ? 'tr__bar tr__bar--over' : 'tr__bar'}
                  />
                ) : (
                  <rect x={x} y={top + plot - 3} width={barW} height={3} rx={1.5} className="tr__bar-empty" />
                )}
              </g>
            );
          })}

          {/* 7-дневное среднее поверх столбиков */}
          {segments.map((seg, si) => (
            <polyline
              key={'avg' + si}
              className="tr__avg"
              points={seg.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')}
            />
          ))}
          {segments.length > 0 &&
            segments[segments.length - 1].map((p, pi, arr) =>
              pi === arr.length - 1 ? (
                <circle key="avgdot" className="tr__avg-dot" cx={p.x} cy={p.y} r="2.6" />
              ) : null,
            )}

          {/* Линия нормы поверх столбиков: так её видно всегда */}
          <line x1="0" x2={width} y1={targetY} y2={targetY} className="tr__target" />

          {data.days.map((d, i) =>
            showTick(i) ? (
              <text
                key={'t' + d.day}
                x={i === lastIndex ? width - 1 : i === 0 ? 0 : i * step + step / 2}
                y={height - 7}
                textAnchor={i === lastIndex ? 'end' : i === 0 ? 'start' : 'middle'}
                className="tr__tick"
              >
                {shortDay(d.day)}
              </text>
            ) : null,
          )}
        </svg>
      </div>
    </div>
  );
}

export function TrendsSheet({ onPaywall }: Props) {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<Metric>('kcal');
  const [data, setData] = useState<Trends | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState<'csv' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .trends(days)
      .then((t) => {
        if (!alive) return;
        setData(t);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setLoading(false);
        if (err instanceof ApiError && (err.code === 'PLUS_REQUIRED' || err.status === 402)) {
          setLocked(true);
          return;
        }
        setError('Не удалось загрузить тренды. Попробуйте ещё раз.');
      });
    return () => {
      alive = false;
    };
  }, [days]);

  const hasData = useMemo(() => Boolean(data && data.summary.activeDays > 0), [data]);

  if (locked) return <PaywallSheet mode="feature" />;

  const current = METRICS.find((m) => m.key === metric)!;

  const exportCsv = () => {
    if (!data) return;
    setBusy('csv');
    api
      .exportCsv(data.from, data.to)
      .catch((err) => {
        if (err instanceof ApiError && (err.code === 'PLUS_REQUIRED' || err.status === 402)) onPaywall();
      })
      .finally(() => setBusy(null));
  };

  const openPrint = () => {
    if (!data) return;
    window.open('/app/print?from=' + data.from + '&to=' + data.to, '_blank', 'noopener');
  };

  return (
    <div className="tr">
      <nav className="segmented" aria-label="Период">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            className={'nav-link' + (days === p ? ' active' : '')}
            onClick={() => setDays(p)}
          >
            {p} дней
          </button>
        ))}
      </nav>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading && !data && (
        <div className="tr__skeleton" aria-busy="true" aria-label="Загружаем тренды">
          <div className="tr__skeleton-row">
            <div className="tr__skeleton-stat" />
            <div className="tr__skeleton-stat" />
            <div className="tr__skeleton-stat" />
          </div>
          <div className="tr__skeleton-card" />
        </div>
      )}

      {data && !hasData && (
        <div className="tr__empty">
          <span className="tr__empty-icon" aria-hidden="true">
            <IconChart size={22} />
          </span>
          <p className="tr__empty-title">За этот период записей нет</p>
          <p className="tr__empty-text">
            Добавьте приём пищи в дневник — и здесь появятся графики, средние и серия дней.
          </p>
        </div>
      )}

      {data && hasData && (
        <>
          <div className="tr__stats">
            <div className="tr__stat">
              <span className="tr__stat-value">{num(data.summary.avgKcal)}</span>
              <span className="tr__stat-label">ккал в среднем</span>
            </div>
            <div className="tr__stat">
              <span className="tr__stat-value">{data.summary.streak}</span>
              <span className="tr__stat-label">
                {data.summary.streak === 1 ? 'день подряд' : 'дней подряд'}
              </span>
            </div>
            <div className="tr__stat">
              <span className="tr__stat-value">
                {data.summary.inNormDays}
                <small>/{data.summary.activeDays}</small>
              </span>
              <span className="tr__stat-label">дней в норме</span>
            </div>
          </div>

          <div className="tr__card">
            <div className="tr__card-head">
              <span className="bb-label">{current.name}</span>
              <span className="tr__card-meta">
                {shortDay(data.from)} — {longDay(data.to)}
              </span>
            </div>
            <nav className="segmented segmented--sm" aria-label="Показатель">
              {METRICS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={'nav-link' + (metric === m.key ? ' active' : '')}
                  onClick={() => setMetric(m.key)}
                >
                  {m.short}
                </button>
              ))}
            </nav>
            <p className="tr__norm">
              <span className="tr__dash" aria-hidden="true" />
              норма {num(data.targets[metric])} {current.unit}
            </p>
            <Chart data={data} metric={metric} />
            <div className="tr__legend">
              <span>
                <span className="tr__line-key" aria-hidden="true" />
                7-дневное среднее
              </span>
              {metric === 'kcal' && data.summary.overDays > 0 && (
                <span>
                  <span className="tr__dot tr__dot--over" aria-hidden="true" />
                  {data.summary.overDays}{' '}
                  {data.summary.overDays === 1 ? 'день' : 'дней'} с перебором
                </span>
              )}
            </div>
          </div>

          <div className="tr__card tr__card--tight">
            <span className="bb-label">Среднее в активные дни</span>
            <div className="tr__macros">
              <span>
                <b>{num(data.summary.avgProtein)}</b> белки
              </span>
              <span>
                <b>{num(data.summary.avgFat)}</b> жиры
              </span>
              <span>
                <b>{num(data.summary.avgCarbs)}</b> углеводы
              </span>
            </div>
          </div>

          <div className="tr__actions">
            <button type="button" className="tr__action" disabled={busy !== null} onClick={exportCsv}>
              <span className="tr__action-icon">
                <IconDownload />
              </span>
              <span className="tr__action-text">
                <b>{busy === 'csv' ? 'Готовим файл…' : 'Скачать CSV'}</b>
                <small>Все приёмы пищи за период</small>
              </span>
            </button>
            <button type="button" className="tr__action" onClick={openPrint}>
              <span className="tr__action-icon">
                <IconPrint />
              </span>
              <span className="tr__action-text">
                <b>Отчёт для печати</b>
                <small>PDF через печать браузера</small>
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
