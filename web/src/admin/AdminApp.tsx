
import { useEffect, useState } from 'react';
import { YANDEX_SIGN_IN_URL } from '../api';
import { adminApi } from './adminApi';
import './admin.css';
import FunnelTab from './FunnelTab';
import PaymentsTab from './PaymentsTab';

type Tab = 'overview' | 'funnel' | 'payments' | 'users' | 'catalog' | 'queries' | 'ai' | 'settings' | 'audit';

const TABS: { id: Tab; name: string }[] = [
  { id: 'overview', name: 'Обзор' },
  { id: 'funnel', name: 'Воронка' },
  { id: 'payments', name: 'Платежи' },
  { id: 'users', name: 'Пользователи' },
  { id: 'catalog', name: 'Каталог' },
  { id: 'queries', name: 'Очередь' },
  { id: 'ai', name: 'ИИ' },
  { id: 'settings', name: 'Настройки' },
  { id: 'audit', name: 'Журнал' },
];

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

function Stat(props: { label: string; value: string }) {
  return (
    <div className="col-6 col-md-4 col-lg-3">
      <div className="card admin-stat">
        <div className="admin-stat-value">{props.value}</div>
        <div className="admin-stat-label">{props.label}</div>
      </div>
    </div>
  );
}

function Bars(props: { data: { day: string; count: string }[]; title: string }) {
  const max = Math.max(1, ...props.data.map(function (d) { return Number(d.count) || 0; }));
  return (
    <div className="card p-3">
      <h6>{props.title}</h6>
      <div className="admin-bars">
        {props.data.map(function (d) {
          const h = Math.max(3, Math.round((Number(d.count) / max) * 90));
          return (
            <div key={d.day} className="admin-bar" title={d.day + ': ' + d.count}>
              <div className="admin-bar-fill" style={{ height: h + 'px' }} />
              <div className="admin-bar-day">{d.day.slice(5)}</div>
            </div>
          );
        })}
        {props.data.length === 0 && <div className="text-muted">Нет данных</div>}
      </div>
    </div>
  );
}

function Overview() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(function () {
    setData(null);
    setErr(null);
    adminApi.overview(days).then(setData).catch(function (e: any) { setErr(e.message || 'Ошибка'); });
  }, [days]);
  if (err) return <div className="alert alert-danger">{err}</div>;
  if (!data) return <div className="admin-loading">Загрузка…</div>;
  const t = data.totals || {};
  return (
    <div>
      <div className="d-flex gap-2 mb-3">
        {[7, 30, 90].map(function (d) {
          return <button key={d} className={'btn btn-sm ' + (days === d ? 'btn-primary' : 'btn-outline-secondary')} onClick={function () { setDays(d); }}>{d} дн.</button>;
        })}
      </div>
      <div className="row g-3 mb-3">
        <Stat label="Пользователи" value={str(t.users)} />
        <Stat label="Plus" value={str(t.plus_users)} />
        <Stat label="Заблокировано" value={str(t.blocked)} />
        <Stat label="Записей всего" value={str(t.entries)} />
        <Stat label={'Записей за ' + days + ' дн.'} value={str(t.entries_period)} />
        <Stat label="Каталог (позиций)" value={str(t.catalog)} />
        <Stat label="Push-подписки" value={str(t.push_subs)} />
        <Stat label="Ошибки очереди" value={str(t.failed_queries)} />
      </div>
      <div className="row g-3 mb-3">
        <div className="col-md-4"><Bars data={data.registrations} title="Регистрации" /></div>
        <div className="col-md-4"><Bars data={data.entries} title="Записи дневника" /></div>
        <div className="col-md-4"><Bars data={data.active} title="Активные пользователи" /></div>
      </div>
      <div className="row g-3">
        <div className="col-md-6">
          <div className="card p-3">
            <h6>Топ продуктов</h6>
            <table className="table table-sm">
              <tbody>
                {(data.topProducts || []).map(function (p: any) {
                  return <tr key={p.id}><td>{str(p.name)}</td><td className="text-muted">{str(p.brand)}</td><td className="text-end">{str(p.use_count)}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card p-3">
            <h6>Очередь Perek</h6>
            <table className="table table-sm">
              <tbody>
                {(data.queueStats || []).map(function (s: any) {
                  return <tr key={s.status}><td>{s.status}</td><td className="text-end">{s.count}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card p-3">
            <h6>API usage</h6>
            <table className="table table-sm">
              <tbody>
                {(data.apiUsage || []).slice(0, 8).map(function (u: any, i: number) {
                  return <tr key={i}><td>{str(u.provider)}<br /><span className="text-muted">{str(u.month)}</span></td><td className="text-end">{str(u.used)}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Users() {
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState('all');
  const [blocked, setBlocked] = useState('all');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const limit = 20;
  const load = function () {
    adminApi.users({ q: q, plan: plan, blocked: blocked, limit: limit, offset: offset }).then(function (r) { setRows(r.users); setTotal(r.total); }).catch(function () { });
  };
  useEffect(load, [plan, blocked, offset]);
  return (
    <div className="row g-3">
      <div className="col-lg-6">
        <div className="d-flex gap-2 mb-2 flex-wrap">
          <input className="form-control" style={{ maxWidth: 220 }} placeholder="Логин, имя, email" value={q} onChange={function (e) { setQ(e.target.value); }} onKeyDown={function (e) { if (e.key === 'Enter') { setOffset(0); load(); } }} />
          <button className="btn btn-outline-primary btn-sm" onClick={function () { setOffset(0); load(); }}>Найти</button>
          <select className="form-select form-select-sm" style={{ maxWidth: 130 }} value={plan} onChange={function (e) { setPlan(e.target.value); setOffset(0); }}>
            <option value="all">Все тарифы</option>
            <option value="free">Free</option>
            <option value="plus">Plus</option>
          </select>
          <select className="form-select form-select-sm" style={{ maxWidth: 150 }} value={blocked} onChange={function (e) { setBlocked(e.target.value); setOffset(0); }}>
            <option value="all">Все статусы</option>
            <option value="no">Активные</option>
            <option value="yes">Заблокированные</option>
          </select>
        </div>
        <div className="text-muted mb-2">Всего: {total}</div>
        <div className="list-group">
          {rows.map(function (u: any) {
            return (
              <button key={u.id} className={'list-group-item list-group-item-action' + (selected === u.id ? ' active' : '')} onClick={function () { setSelected(Number(u.id)); }}>
                <span className="fw-semibold">#{str(u.id)} {str(u.display_name) || str(u.login)}</span>
                <span className="text-muted"> · {str(u.login)}</span>
                {u.plan === 'plus' && <span className="badge bg-warning text-dark ms-2">Plus</span>}
                {u.is_blocked && <span className="badge bg-danger ms-2">blocked</span>}
                <br /><span className={'small ' + (selected === u.id ? '' : 'text-muted')}>{str(u.email)} · {str(u.role)}</span>
              </button>
            );
          })}
        </div>
        <div className="d-flex gap-2 mt-2">
          <button className="btn btn-sm btn-outline-secondary" disabled={offset === 0} onClick={function () { setOffset(Math.max(0, offset - limit)); }}>Назад</button>
          <button className="btn btn-sm btn-outline-secondary" disabled={offset + limit >= total} onClick={function () { setOffset(offset + limit); }}>Вперёд</button>
        </div>
      </div>
      <div className="col-lg-6">
        {selected === null ? <div className="text-muted">Выберите пользователя</div> : <UserDetail id={selected} onChanged={load} />}
      </div>
    </div>
  );
}

function UserDetail(props: { id: number; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(function () {
    setD(null);
    adminApi.userDetail(props.id).then(function (r) { setD(r); setForm({ role: r.user.role, plan: r.user.plan, is_blocked: r.user.is_blocked, blocked_reason: r.user.blocked_reason || '', note: r.user.note || '' }); }).catch(function (e: any) { setMsg(e.message); });
  }, [props.id]);
  if (!d) return <div className="admin-loading">{msg || 'Загрузка…'}</div>;
  const u = d.user;
  const counts = d.counts || {};
  const save = function () {
    setMsg(null);
    adminApi.patchUser(props.id, form).then(function () { setMsg('Сохранено'); props.onChanged(); }).catch(function (e: any) { setMsg(e.message); });
  };
  const del = function () {
    if (!window.confirm('Удалить пользователя #' + props.id + ' и все его данные?')) return;
    adminApi.deleteUser(props.id).then(function () { setMsg('Удалён'); props.onChanged(); }).catch(function (e: any) { setMsg(e.message); });
  };
  const set = function (k: string, v: unknown) { setForm(Object.assign({}, form, (function () { const o: any = {}; o[k] = v; return o; })())); };
  return (
    <div className="card p-3">
      <h5>#{str(u.id)} {str(u.display_name) || str(u.login)}</h5>
      <div className="text-muted small mb-2">{str(u.login)} · {str(u.email)} · reg {str(u.created_at)}</div>
      <div className="d-flex gap-3 flex-wrap mb-2 small">
        <span>Записей: <b>{str(counts.entries)}</b></span>
        <span>Своих продуктов: <b>{str(counts.own_products)}</b></span>
        <span>Push: <b>{str(counts.push)}</b></span>
        <span>ИИ-запросов: <b>{str(counts.ai)}</b></span>
      </div>
      <div className="admin-minibars mb-3">
        {(d.lastDays || []).map(function (x: any) {
          return <div key={x.day} className="admin-minibar" title={x.day + ': ' + x.count}><div className="admin-minibar-fill" style={{ height: Math.min(36, 4 + Number(x.count) * 4) + 'px' }} /></div>;
        })}
      </div>
      <div className="row g-2 mb-2">
        <div className="col-6"><label className="form-label">Роль</label>
          <select className="form-select form-select-sm" value={str(form.role)} onChange={function (e) { set('role', e.target.value); }}>
            <option value="user">user</option><option value="analyst">analyst</option><option value="support">support</option><option value="content">content</option><option value="admin">admin</option><option value="superadmin">superadmin</option>
          </select></div>
        <div className="col-6"><label className="form-label">Тариф</label>
          <select className="form-select form-select-sm" value={str(form.plan)} onChange={function (e) { set('plan', e.target.value); }}>
            <option value="free">free</option><option value="plus">plus</option>
          </select></div>
      </div>
      <div className="form-check mb-2">
        <input className="form-check-input" type="checkbox" checked={!!form.is_blocked} onChange={function (e) { set('is_blocked', e.target.checked); }} id={'blk' + props.id} />
        <label className="form-check-label" htmlFor={'blk' + props.id}>Заблокирован</label>
      </div>
      <input className="form-control form-control-sm mb-2" placeholder="Причина блокировки" value={str(form.blocked_reason)} onChange={function (e) { set('blocked_reason', e.target.value); }} />
      <textarea className="form-control form-control-sm mb-2" placeholder="Заметка саппорта" value={str(form.note)} onChange={function (e) { set('note', e.target.value); }} />
      {msg && <div className="alert alert-info py-1">{msg}</div>}
      <div className="d-flex gap-2">
        <button className="btn btn-primary btn-sm" onClick={save}>Сохранить</button>
        <button className="btn btn-outline-danger btn-sm" onClick={del}>Удалить</button>
      </div>
      <h6 className="mt-3">Последние записи</h6>
      <table className="table table-sm small"><tbody>
        {(d.recentEntries || []).map(function (e: any) {
          return <tr key={e.id}><td>{str(e.day)}</td><td>{str(e.meal)}</td><td>{str(e.name)}</td><td className="text-end">{str(e.grams)} г</td></tr>;
        })}
      </tbody></table>
    </div>
  );
}

function Catalog() {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('all');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState<any>({});
  const limit = 20;
  const load = function () {
    adminApi.products({ q: q, source: source, limit: limit, offset: offset }).then(function (r) { setRows(r.products); setTotal(r.total); }).catch(function () { });
  };
  useEffect(load, [source, offset]);
  const startEdit = function (p: any) { setEditId(Number(p.id)); setDraft({ name: p.name, brand: p.brand, kcal: p.kcal, protein: p.protein, fat: p.fat, carbs: p.carbs, barcode: p.barcode, is_hidden: p.is_hidden }); };
  const saveEdit = function () {
    if (editId === null) return;
    const patch: any = Object.assign({}, draft);
    ['kcal', 'protein', 'fat', 'carbs'].forEach(function (k) { if (patch[k] !== '' && patch[k] !== undefined) patch[k] = Number(patch[k]); });
    adminApi.patchProduct(editId, patch).then(function () { setEditId(null); load(); }).catch(function () { });
  };
  return (
    <div>
      <div className="d-flex gap-2 mb-2 flex-wrap">
        <input className="form-control" style={{ maxWidth: 240 }} placeholder="Название, бренд, штрихкод" value={q} onChange={function (e) { setQ(e.target.value); }} onKeyDown={function (e) { if (e.key === 'Enter') { setOffset(0); load(); } }} />
        <button className="btn btn-outline-primary btn-sm" onClick={function () { setOffset(0); load(); }}>Найти</button>
        <select className="form-select form-select-sm" style={{ maxWidth: 150 }} value={source} onChange={function (e) { setSource(e.target.value); setOffset(0); }}>
          <option value="all">Все источники</option><option value="perek">perek</option><option value="off">off</option><option value="np">np</option><option value="ai">ai</option>
        </select>
        <span className="text-muted align-self-center">Всего: {total}</span>
      </div>
      <table className="table table-sm align-middle">
        <thead><tr><th>Продукт</th><th>КБЖУ /100</th><th>Использ.</th><th></th></tr></thead>
        <tbody>
          {rows.map(function (p: any) {
            const id = Number(p.id);
            if (editId === id) {
              return (
                <tr key={id}>
                  <td>
                    <input className="form-control form-control-sm mb-1" value={str(draft.name)} onChange={function (e) { setDraft(Object.assign({}, draft, { name: e.target.value })); }} />
                    <div className="d-flex gap-1">
                      <input className="form-control form-control-sm" placeholder="Бренд" value={str(draft.brand)} onChange={function (e) { setDraft(Object.assign({}, draft, { brand: e.target.value })); }} />
                      <input className="form-control form-control-sm" placeholder="Штрихкод" value={str(draft.barcode)} onChange={function (e) { setDraft(Object.assign({}, draft, { barcode: e.target.value })); }} />
                    </div>
                  </td>
                  <td>
                    <div className="d-flex gap-1">
                      {['kcal', 'protein', 'fat', 'carbs'].map(function (k) {
                        return <input key={k} className="form-control form-control-sm" style={{ maxWidth: 70 }} value={str(draft[k])} onChange={function (e) { const o: any = {}; o[k] = e.target.value; setDraft(Object.assign({}, draft, o)); }} />;
                      })}
                    </div>
                    <div className="form-check mt-1"><input className="form-check-input" type="checkbox" checked={!!draft.is_hidden} onChange={function (e) { setDraft(Object.assign({}, draft, { is_hidden: e.target.checked })); }} id={'h' + id} /><label className="form-check-label small" htmlFor={'h' + id}>Скрыт</label></div>
                  </td>
                  <td>{str(p.use_count)}</td>
                  <td className="text-end"><button className="btn btn-sm btn-primary me-1" onClick={saveEdit}>ОК</button><button className="btn btn-sm btn-outline-secondary" onClick={function () { setEditId(null); }}>×</button></td>
                </tr>
              );
            }
            return (
              <tr key={id} className={p.is_hidden ? 'table-secondary' : ''}>
                <td><span className="fw-semibold">{str(p.name)}</span> <span className="text-muted small">{str(p.brand)} · {str(p.source)} · {str(p.barcode)}</span></td>
                <td className="small">{str(p.kcal)} / {str(p.protein)} / {str(p.fat)} / {str(p.carbs)}</td>
                <td>{str(p.use_count)}</td>
                <td className="text-end text-nowrap">
                  <button className="btn btn-sm btn-outline-secondary me-1" onClick={function () { startEdit(p); }}>Изм.</button>
                  <button className="btn btn-sm btn-outline-danger" onClick={function () { if (window.confirm('Удалить из каталога?')) adminApi.deleteProduct(id).then(load); }}>Удал.</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="d-flex gap-2">
        <button className="btn btn-sm btn-outline-secondary" disabled={offset === 0} onClick={function () { setOffset(Math.max(0, offset - limit)); }}>Назад</button>
        <button className="btn btn-sm btn-outline-secondary" disabled={offset + limit >= total} onClick={function () { setOffset(offset + limit); }}>Вперёд</button>
      </div>
    </div>
  );
}

function Queries() {
  const [status, setStatus] = useState('failed');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const load = function () {
    adminApi.queries({ status: status, limit: 30, offset: 0 }).then(function (r) { setRows(r.queries); setTotal(r.total); }).catch(function () { });
  };
  useEffect(load, [status]);
  return (
    <div>
      <div className="d-flex gap-2 mb-2 align-items-center">
        <select className="form-select form-select-sm" style={{ maxWidth: 180 }} value={status} onChange={function (e) { setStatus(e.target.value); }}>
          <option value="all">Все</option><option value="failed">failed</option><option value="pending">pending</option><option value="done">done</option><option value="empty">empty</option>
        </select>
        <span className="text-muted">Всего: {total}</span>
      </div>
      <table className="table table-sm">
        <thead><tr><th>Запрос</th><th>Хиты</th><th>Статус</th><th>Ошибка</th><th></th></tr></thead>
        <tbody>
          {rows.map(function (r: any) {
            return (
              <tr key={r.query}>
                <td>{str(r.raw_query)}<br /><span className="text-muted small">{str(r.query)}</span></td>
                <td>{str(r.hits)}</td>
                <td><span className="badge bg-secondary">{str(r.status)}</span></td>
                <td className="small text-muted">{str(r.last_error)}</td>
                <td className="text-end"><button className="btn btn-sm btn-outline-primary" onClick={function () { adminApi.retryQuery(str(r.query)).then(load); }}>Повторить</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AiUsage() {
  const [data, setData] = useState<any>(null);
  useEffect(function () { adminApi.aiUsage(30).then(setData).catch(function () { }); }, []);
  if (!data) return <div className="admin-loading">Загрузка…</div>;
  return (
    <div className="row g-3">
      <div className="col-md-6"><Bars data={(data.perDay || []).map(function (x: any) { return { day: str(x.day), count: str(x.total) }; })} title="ИИ-запросы по дням" /></div>
      <div className="col-md-6">
        <div className="card p-3"><h6>Топ пользователей (30 дн.)</h6>
          <table className="table table-sm"><tbody>
            {(data.top || []).map(function (u: any) {
              return <tr key={u.id}><td>#{str(u.id)} {str(u.login)}</td><td className="text-end">{str(u.total)}</td></tr>;
            })}
          </tbody></table>
        </div>
      </div>
    </div>
  );
}

function SettingsTab() {
  const [s, setS] = useState<Record<string, any>>({});
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(function () { adminApi.settings().then(function (r) { setS(r.settings || {}); }).catch(function () { }); }, []);
  const save = function (key: string) {
    adminApi.saveSetting(key, s[key]).then(function () { setMsg('Сохранено: ' + key); }).catch(function (e: any) { setMsg(e.message); });
  };
  const setVal = function (key: string, v: any) { const o: any = {}; o[key] = v; setS(Object.assign({}, s, o)); };
  return (
    <div style={{ maxWidth: 560 }}>
      {msg && <div className="alert alert-info py-1">{msg}</div>}
      <div className="card p-3 mb-2">
        <label className="form-label">AI: фото в месяц (Free)</label>
        <div className="d-flex gap-2"><input className="form-control" type="number" value={str(s.ai_free_monthly)} onChange={function (e) { setVal('ai_free_monthly', Number(e.target.value)); }} /><button className="btn btn-outline-primary btn-sm" onClick={function () { save('ai_free_monthly'); }}>ОК</button></div>
      </div>
      <div className="card p-3 mb-2">
        <label className="form-label">AI: фото в день (Plus)</label>
        <div className="d-flex gap-2"><input className="form-control" type="number" value={str(s.ai_plus_daily)} onChange={function (e) { setVal('ai_plus_daily', Number(e.target.value)); }} /><button className="btn btn-outline-primary btn-sm" onClick={function () { save('ai_plus_daily'); }}>ОК</button></div>
      </div>
      <div className="card p-3 mb-2">
        <div className="form-check"><input className="form-check-input" type="checkbox" checked={s.maintenance_mode === true} onChange={function (e) { setVal('maintenance_mode', e.target.checked); }} id="mm" /><label className="form-check-label" htmlFor="mm">Режим обслуживания</label></div>
        <button className="btn btn-outline-primary btn-sm mt-2" onClick={function () { save('maintenance_mode'); }}>Сохранить</button>
      </div>
      <div className="card p-3 mb-2">
        <label className="form-label">Баннер поддержки</label>
        <div className="d-flex gap-2"><input className="form-control" value={str(s.support_banner)} onChange={function (e) { setVal('support_banner', e.target.value); }} /><button className="btn btn-outline-primary btn-sm" onClick={function () { save('support_banner'); }}>ОК</button></div>
      </div>
    </div>
  );
}

function AuditTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  useEffect(function () {
    adminApi.audit(30, offset).then(function (r) { setRows(r.log); setTotal(r.total); }).catch(function () { });
  }, [offset]);
  return (
    <div>
      <div className="text-muted mb-2">Всего: {total}</div>
      <table className="table table-sm small">
        <thead><tr><th>ID</th><th>Когда</th><th>Админ</th><th>Действие</th><th>Цель</th><th>Детали</th></tr></thead>
        <tbody>
          {rows.map(function (r: any) {
            return <tr key={r.id}><td>{str(r.id)}</td><td>{str(r.created_at)}</td><td>{str(r.admin_login)}</td><td>{str(r.action)}</td><td>{str(r.target_type)}:{str(r.target_id)}</td><td className="text-muted">{JSON.stringify(r.details)}</td></tr>;
          })}
        </tbody>
      </table>
      <div className="d-flex gap-2">
        <button className="btn btn-sm btn-outline-secondary" disabled={offset === 0} onClick={function () { setOffset(Math.max(0, offset - 30)); }}>Назад</button>
        <button className="btn btn-sm btn-outline-secondary" disabled={offset + 30 >= total} onClick={function () { setOffset(offset + 30); }}>Вперёд</button>
      </div>
    </div>
  );
}

export default function AdminApp() {
  const [me, setMe] = useState<{ id: number; login: string; role: string } | null>(null);
  const [err, setErr] = useState<{ status: number; message: string } | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(function () {
    adminApi.me().then(setMe).catch(function (e: any) { setErr({ status: e.status || 0, message: e.message || 'Ошибка' }); });
  }, []);
  if (err) {
    return (
      <div className="container py-5" style={{ maxWidth: 560 }}>
        <h3>Админка</h3>
        {err.status === 401 ? (
          <div><p>Нужно войти через Яндекс ID.</p><a className="btn btn-primary" href={YANDEX_SIGN_IN_URL}>Войти</a></div>
        ) : (
          <div className="alert alert-warning">Нет доступа ({err.message}). Попросите суперадмина выдать роль или задайте ADMIN_LOGINS на сервере и зайдите снова.</div>
        )}
      </div>
    );
  }
  if (!me) return <div className="container py-5">Загрузка…</div>;
  return (
    <div className="admin">
      <nav className="navbar navbar-dark bg-dark">
        <div className="container-fluid">
          <span className="navbar-brand">BiteBalance · Админка</span>
          <span className="text-light small">{me.login} · {me.role} <a className="link-light ms-2" href="/app/">в приложение</a></span>
        </div>
      </nav>
      <div className="container-fluid py-3">
        <ul className="nav nav-tabs mb-3">
          {TABS.map(function (t) {
            return <li key={t.id} className="nav-item"><button className={'nav-link' + (tab === t.id ? ' active' : '')} onClick={function () { setTab(t.id); }}>{t.name}</button></li>;
          })}
        </ul>
        {tab === 'overview' && <Overview />}
        {tab === 'funnel' && <FunnelTab />}
        {tab === 'payments' && <PaymentsTab />}
        {tab === 'users' && <Users />}
        {tab === 'catalog' && <Catalog />}
        {tab === 'queries' && <Queries />}
        {tab === 'ai' && <AiUsage />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  );
}
