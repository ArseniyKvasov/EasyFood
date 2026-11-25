
import { useEffect, useState } from 'react';
import { adminApi } from './adminApi';

type Step = { key: string; label: string; count: number; rate_prev: number | null; rate_first: number | null; independent: boolean };
type Opt = { key: string; label: string; count: number };

type FunnelData = {
  filters: Record<string, unknown>;
  period: { from: string; to: string };
  summary: Record<string, unknown>;
  funnel: { total: number; steps: Step[] };
  options: Record<string, Opt[]>;
};

const LS_KEY = 'bb:admin-funnel:period';
const PRESETS = [
  { key: '7', name: '7 дней' },
  { key: '30', name: '30 дней' },
  { key: '90', name: '90 дней' },
  { key: 'all', name: 'Всё время' },
];

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const todayIso = (): string => iso(new Date());
const shiftIso = (base: string, days: number): string => {
  const d = new Date(base + 'T00:00:00Z');
  return iso(new Date(d.getTime() + days * 86400000));
};

const num = (v: unknown): string => Number(v || 0).toLocaleString('ru-RU');
const pct = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  return String(v).replace('.', ',') + '%';
};

function readPeriod(): { preset: string; from: string; to: string } {
  const to = todayIso();
  const fallback = { preset: '30', from: shiftIso(to, -29), to: to };
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as { preset?: string; from?: string; to?: string; toToday?: boolean };
    if (s.preset && PRESETS.some(function (p) { return p.key === s.preset; })) {
      if (s.preset === 'all') return { preset: 'all', from: '2020-01-01', to: to };
      return { preset: s.preset, from: shiftIso(to, -Number(s.preset) + 1), to: to };
    }
    if (s.from && s.to && /^\d{4}-\d{2}-\d{2}$/.test(s.from) && /^\d{4}-\d{2}-\d{2}$/.test(s.to) && s.from <= s.to) {
      return { preset: '', from: s.from, to: s.toToday ? to : s.to };
    }
  } catch { }
  return fallback;
}

/** SVG-воронка как в FastClass: блоки по sqrt-доле первого шага, сужающиеся связки. */
function FunnelSvg(props: { steps: Step[] }) {
  const COL = 200;
  const BLOCK = 150;
  const H = 150;
  const MID = H / 2;
  const steps = props.steps;
  const max = Math.max.apply(null, [0].concat(steps.map(function (s) { return s.count; })));
  const heightOf = function (count: number): number {
    if (!count || !max) return 2;
    return Math.max(Math.sqrt(count / max) * (H - 6), 10);
  };
  const width = steps.length * COL - (COL - BLOCK);
  const opacity = function (i: number): number { return Math.max(0.45, 1 - i * 0.13); };
  return (
    <div className="fn-scroll">
      <div style={{ width: width + 'px' }}>
        <div className="fn-labels" style={{ gridTemplateColumns: 'repeat(' + steps.length + ', ' + COL + 'px)' }}>
          {steps.map(function (s) {
            return (
              <div key={s.key} className="fn-label">
                {s.label}
                {s.independent && <span className="badge bg-secondary ms-1" title="Считается по всей когорте, вне цепочки">вне цепочки</span>}
              </div>
            );
          })}
        </div>
        <svg className="fn-shape" width={width} height={H} viewBox={'0 0 ' + width + ' ' + H} role="img" aria-label="Воронка">
          {steps.map(function (s, i) {
            const x = i * COL;
            const h = heightOf(s.count);
            const parts = [];
            if (i < steps.length - 1) {
              const nh = heightOf(steps[i + 1].count);
              parts.push(
                <polygon
                  key={'l' + s.key}
                  className="fn-link"
                  points={(x + BLOCK) + ',' + (MID - h / 2) + ' ' + (x + COL) + ',' + (MID - nh / 2) + ' ' + (x + COL) + ',' + (MID + nh / 2) + ' ' + (x + BLOCK) + ',' + (MID + h / 2)}
                />,
              );
            }
            parts.push(
              <rect
                key={'b' + s.key}
                className="fn-block"
                x={x}
                y={MID - h / 2}
                width={BLOCK}
                height={h}
                rx={Math.min(8, h / 2)}
                opacity={opacity(i)}
              />,
            );
            return parts;
          })}
        </svg>
        <div className="fn-figures" style={{ gridTemplateColumns: 'repeat(' + steps.length + ', ' + COL + 'px)' }}>
          {steps.map(function (s, i) {
            return (
              <div key={s.key} className="fn-cell">
                <strong className="fn-count">{num(s.count)}</strong>
                <span className="fn-share">
                  <b>{i === 0 ? (s.count ? '100%' : '—') : pct(s.rate_first)}</b>
                  {i > 0 && !s.independent && s.rate_prev !== null && <span> · {pct(s.rate_prev)} от пред.</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CheckGroup(props: { title: string; options: Opt[]; selected: string[]; onChange: (next: string[]) => void }) {
  const toggle = function (key: string) {
    if (props.selected.indexOf(key) >= 0) props.onChange(props.selected.filter(function (k) { return k !== key; }));
    else props.onChange(props.selected.concat([key]));
  };
  return (
    <div className="fn-filter">
      <div className="fn-filter-title">{props.title}</div>
      {props.options.map(function (o) {
        const on = props.selected.indexOf(o.key) >= 0;
        return (
          <label key={o.key} className="fn-check">
            <input type="checkbox" checked={on} onChange={function () { toggle(o.key); }} />
            <span>{o.label}</span>
            <span className="text-muted ms-auto">{num(o.count)}</span>
          </label>
        );
      })}
      {props.options.length === 0 && <div className="text-muted small">Нет данных</div>}
    </div>
  );
}

export default function FunnelTab() {
  const [period, setPeriod] = useState(readPeriod);
  const [plan, setPlan] = useState<string[]>([]);
  const [ai, setAi] = useState<string[]>([]);
  const [push, setPush] = useState<string[]>([]);
  const [staff, setStaff] = useState(false);
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(function () {
    let alive = true;
    setLoading(true);
    setError(null);
    adminApi.funnel({
      from: period.from,
      to: period.to,
      plan: plan.join(','),
      ai: ai.join(','),
      push: push.join(','),
      staff: staff ? 1 : 0,
    }).then(function (r) {
      if (alive) { setData(r); setLoading(false); }
    }).catch(function (e: any) {
      if (alive) { setError(e.message || 'Ошибка'); setLoading(false); }
    });
    return function () { alive = false; };
  }, [period, plan, ai, push, staff]);

  const setPreset = function (key: string) {
    const to = todayIso();
    const next = key === 'all'
      ? { preset: 'all', from: '2020-01-01', to: to }
      : { preset: key, from: shiftIso(to, -Number(key) + 1), to: to };
    setPeriod(next);
    try { window.localStorage.setItem(LS_KEY, JSON.stringify({ preset: key })); } catch { }
  };

  const setCustom = function (from: string, to: string) {
    if (!from || !to || from > to) return;
    setPeriod({ preset: '', from: from, to: to });
    try { window.localStorage.setItem(LS_KEY, JSON.stringify({ from: from, to: to, toToday: to === todayIso() })); } catch { }
  };

  const s = data ? data.summary : {};
  return (
    <div>
      <div className="card p-3 mb-3">
        <div className="d-flex gap-2 flex-wrap align-items-center mb-3">
          {PRESETS.map(function (p) {
            return <button key={p.key} className={'btn btn-sm ' + (period.preset === p.key ? 'btn-primary' : 'btn-outline-secondary')} onClick={function () { setPreset(p.key); }}>{p.name}</button>;
          })}
          <input type="date" className="form-control form-control-sm" style={{ maxWidth: 150 }} value={period.from} onChange={function (e) { setCustom(e.target.value, period.to); }} />
          <input type="date" className="form-control form-control-sm" style={{ maxWidth: 150 }} value={period.to} onChange={function (e) { setCustom(period.from, e.target.value); }} />
          <label className="form-check-label small ms-2">
            <input type="checkbox" className="form-check-input me-1" checked={staff} onChange={function (e) { setStaff(e.target.checked); }} />
            включая штаб
          </label>
        </div>
        <div className="row g-3">
          <div className="col-md-4"><CheckGroup title="Тариф" options={data ? data.options.plan : []} selected={plan} onChange={setPlan} /></div>
          <div className="col-md-4"><CheckGroup title="Использование ИИ" options={data ? data.options.ai : []} selected={ai} onChange={setAi} /></div>
          <div className="col-md-4"><CheckGroup title="Push" options={data ? data.options.push : []} selected={push} onChange={setPush} /></div>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {loading && <div className="admin-loading">Считаем воронку…</div>}
      {data && !loading && (
        <div>
          <div className="row g-3 mb-3">
            <div className="col-6 col-md-3"><div className="card admin-stat"><div className="admin-stat-value">{num(s.total)}</div><div className="admin-stat-label">Регистраций</div></div></div>
            <div className="col-6 col-md-3"><div className="card admin-stat"><div className="admin-stat-value">{num(s.plus)}</div><div className="admin-stat-label">Plus · {pct(s.plus_share)}</div></div></div>
            <div className="col-6 col-md-3"><div className="card admin-stat"><div className="admin-stat-value">{num(s.ai_used)}</div><div className="admin-stat-label">Использовали ИИ · {pct(s.ai_share)}</div></div></div>
            <div className="col-6 col-md-3"><div className="card admin-stat"><div className="admin-stat-value">{num(s.push_on)}</div><div className="admin-stat-label">С push · {pct(s.push_share)}</div></div></div>
          </div>
          <div className="card p-3">
            <h6>Когорта {data.period.from} — {data.period.to}: от регистрации к привычке</h6>
            {data.funnel.total === 0
              ? <div className="text-muted">В этом периоде регистраций нет</div>
              : <FunnelSvg steps={data.funnel.steps} />}
          </div>
        </div>
      )}
    </div>
  );
}
