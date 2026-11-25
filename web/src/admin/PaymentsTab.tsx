
import { useEffect, useState } from 'react';
import { adminApi } from './adminApi';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const rub = (kop: unknown): string => (Number(kop || 0) / 100).toLocaleString('ru-RU') + ' \u20BD';

export default function PaymentsTab() {
  const [summary, setSummary] = useState<{ byStatus: { status: string; count: string; total: string }[]; perMonth: { month: string; total: string; count: string }[] } | null>(null);
  const [subs, setSubs] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('all');
  const [msg, setMsg] = useState<string | null>(null);

  const load = function () {
    adminApi.paymentsSummary().then(setSummary).catch(function () { });
    adminApi.subscriptions(30, 0).then(function (r) { setSubs(r.subscriptions); }).catch(function () { });
    adminApi.payments({ status: status, limit: 30, offset: 0 }).then(function (r) { setRows(r.payments); setTotal(r.total); }).catch(function () { });
  };
  useEffect(load, [status]);

  const refund = function (id: number) {
    if (!window.confirm('Оформить полный возврат #' + id + ' через Т-Банк?')) return;
    setMsg(null);
    adminApi.refundPayment(id).then(function (r) {
      setMsg('Возврат оформлен' + (r.revoked ? ', доступ Plus отозван' : ''));
      load();
    }).catch(function (e: any) { setMsg('Ошибка: ' + (e.message || e)); });
  };

  const cancel = function (userId: number) {
    if (!window.confirm('Отключить автопродление у #' + userId + '?')) return;
    adminApi.cancelSubscription(userId).then(function () { setMsg('Автопродление отключено'); load(); }).catch(function (e: any) { setMsg('Ошибка: ' + (e.message || e)); });
  };

  const confirmed = summary ? summary.byStatus.filter(function (s) { return s.status === 'confirmed'; }) : [];
  const confirmedTotal = confirmed.length ? confirmed[0].total : '0';

  return (
    <div>
      {msg && <div className="alert alert-info py-1">{msg}</div>}
      <div className="row g-3 mb-3">
        <div className="col-6 col-md-3"><div className="card admin-stat"><div className="admin-stat-value">{rub(confirmedTotal)}</div><div className="admin-stat-label">Подтверждено</div></div></div>
        <div className="col-6 col-md-3"><div className="card admin-stat"><div className="admin-stat-value">{str(subs.length)}</div><div className="admin-stat-label">Подписок (топ 30)</div></div></div>
        <div className="col-12 col-md-6">
          <div className="card p-3"><h6>Выручка по месяцам</h6>
            <table className="table table-sm mb-0"><tbody>
              {(summary ? summary.perMonth : []).map(function (m) {
                return <tr key={m.month}><td>{m.month}</td><td className="text-end">{rub(m.total)} · {m.count}</td></tr>;
              })}
              {(!summary || summary.perMonth.length === 0) && <tr><td className="text-muted">Пока пусто</td></tr>}
            </tbody></table>
          </div>
        </div>
      </div>
      <div className="card p-3 mb-3">
        <h6>Подписки</h6>
        <table className="table table-sm align-middle">
          <thead><tr><th>User</th><th>Тариф</th><th>Статус</th><th>До</th><th>Отмена</th><th></th></tr></thead>
          <tbody>
            {subs.map(function (s: any) {
              return (
                <tr key={s.user_id}>
                  <td>#{str(s.user_id)} {str(s.login)}</td>
                  <td>{str(s.plan)}</td>
                  <td><span className="badge bg-secondary">{str(s.status)}</span>{s.has_rebill ? '' : ' (без ребилла)'}</td>
                  <td className="small">{str(s.current_end).slice(0, 10)}</td>
                  <td className="small">{s.cancel_at ? str(s.cancel_at).slice(0, 10) : '—'}</td>
                  <td className="text-end"><button className="btn btn-sm btn-outline-secondary" onClick={function () { cancel(Number(s.user_id)); }}>Отменить продление</button></td>
                </tr>
              );
            })}
            {subs.length === 0 && <tr><td colSpan={6} className="text-muted">Подписок нет</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card p-3">
        <div className="d-flex gap-2 align-items-center mb-2">
          <h6 className="mb-0">Платежи</h6>
          <select className="form-select form-select-sm" style={{ maxWidth: 170 }} value={status} onChange={function (e) { setStatus(e.target.value); }}>
            <option value="all">Все</option><option value="pending">pending</option><option value="confirmed">confirmed</option><option value="rejected">rejected</option><option value="refunded">refunded</option><option value="failed">failed</option>
          </select>
          <span className="text-muted small">Всего: {total}</span>
        </div>
        <table className="table table-sm align-middle">
          <thead><tr><th>ID</th><th>User</th><th>Сумма</th><th>Тариф</th><th>Тип</th><th>Статус</th><th>Оплачен</th><th></th></tr></thead>
          <tbody>
            {rows.map(function (p: any) {
              return (
                <tr key={p.id}>
                  <td>{str(p.id)}<br /><span className="text-muted small">{str(p.order_id)}</span></td>
                  <td>#{str(p.user_id)} {str(p.login)}</td>
                  <td>{rub(p.amount)}</td>
                  <td>{str(p.plan)}</td>
                  <td>{str(p.kind)}</td>
                  <td><span className="badge bg-secondary">{str(p.status)}</span></td>
                  <td className="small">{str(p.paid_at).slice(0, 16)}</td>
                  <td className="text-end">{p.status === 'confirmed' && <button className="btn btn-sm btn-outline-danger" onClick={function () { refund(Number(p.id)); }}>Возврат</button>}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="text-muted">Платежей нет</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
