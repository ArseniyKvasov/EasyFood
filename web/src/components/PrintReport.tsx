
import { useEffect, useState } from 'react';
import { api } from '../api';
import './print.css';

type Trends = Awaited<ReturnType<typeof api.trends>>;
type Range = Awaited<ReturnType<typeof api.diaryRange>>;

const MEAL_NAMES: Record<string, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
};

const num = (v: string | number): string => Number(v || 0).toLocaleString('ru-RU');

function params(): { from: string; to: string } {
  const q = new URLSearchParams(window.location.search);
  const to = q.get('to') || new Date().toISOString().slice(0, 10);
  const from = q.get('from') || to;
  return { from: from, to: to };
}

export default function PrintReport() {
  const [p] = useState(params);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [range, setRange] = useState<Range | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(function () {
    let alive = true;
    Promise.all([api.trends(365), api.diaryRange(p.from, p.to)])
      .then(function (parts) {
        if (!alive) return;
        const days = parts[0].days.filter(function (d) { return d.day >= p.from && d.day <= p.to; });
        setTrends({ from: p.from, to: p.to, days: days, targets: parts[0].targets, summary: parts[0].summary });
        setRange(parts[1]);
      })
      .catch(function (e: any) {
        if (alive) setError(e.message || 'Не удалось загрузить отчёт. Войдите в приложение и откройте страницу оттуда.');
      });
    return function () { alive = false; };
  }, [p]);

  if (error) {
    return (
      <div className="print-doc">
        <h1>Отчёт BiteBalance</h1>
        <p>{error}</p>
        <p className="no-print">Откройте эту страницу из приложения: Тренды → Отчёт для печати.</p>
      </div>
    );
  }
  if (!trends || !range) return <div className="print-doc"><p>Готовим отчёт…</p></div>;

  const byDay: Record<string, typeof range.entries> = {};
  for (const e of range.entries) {
    if (!byDay[e.day]) byDay[e.day] = [];
    byDay[e.day].push(e);
  }

  return (
    <div className="print-doc">
      <div className="no-print print-bar">
        <span>BiteBalance · отчёт {p.from} - {p.to}</span>
        <button type="button" onClick={function () { window.print(); }}>Печать / сохранить PDF</button>
      </div>
      <h1>Дневник питания {p.from} - {p.to}</h1>
      <table className="print-table">
        <tbody>
          <tr><th>Активных дней</th><td>{trends.summary.activeDays} из {trends.summary.totalDays}</td></tr>
          <tr><th>Средне ккал/день</th><td>{num(trends.summary.avgKcal)} (норма {num(trends.targets.kcal)})</td></tr>
          <tr><th>Среднее Б / Ж / У</th><td>{num(trends.summary.avgProtein)} / {num(trends.summary.avgFat)} / {num(trends.summary.avgCarbs)} г</td></tr>
          <tr><th>Стрик</th><td>{trends.summary.streak} дн. подряд</td></tr>
          <tr><th>Дней в норме / с перебором</th><td>{trends.summary.inNormDays} / {trends.summary.overDays}</td></tr>
        </tbody>
      </table>
      {trends.days.filter(function (d) { return d.entries > 0; }).map(function (d) {
        return (
          <section key={d.day} className="print-day">
            <h2>{d.day} - {num(d.kcal)} ккал (Б {num(d.protein)} · Ж {num(d.fat)} · У {num(d.carbs)})</h2>
            <table className="print-table">
              <thead><tr><th>Приём</th><th>Продукт</th><th>Граммы</th><th>Ккал</th></tr></thead>
              <tbody>
                {(byDay[d.day] || []).map(function (e, i) {
                  return (
                    <tr key={i}>
                      <td>{MEAL_NAMES[e.meal] || e.meal}</td>
                      <td>{e.name}</td>
                      <td>{num(e.grams)}</td>
                      <td>{num(e.kcal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
