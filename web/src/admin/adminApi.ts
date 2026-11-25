import { ApiError } from '../api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', headers: init && init.body ? { 'Content-Type': 'application/json' } : undefined, ...init });
  if (!res.ok) {
    let code = 'ERROR';
    let message = 'Ошибка ' + res.status;
    try {
      const data = await res.json() as { error?: string; message?: string };
      code = data.error || code;
      message = data.message || message;
    } catch { }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const qs = (o: Record<string, string | number>): string => Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(String(o[k])); }).join('&');

export type AdminMe = { id: number; login: string; role: string };

export const adminApi = {
  me: () => req<AdminMe>('/api/admin/me'),
  overview: (days: number) => req<{ totals: Record<string, string>; registrations: { day: string; count: string }[]; entries: { day: string; count: string }[]; active: { day: string; count: string }[]; ai: { day: string; count: string }[]; topProducts: Record<string, unknown>[]; queueStats: { status: string; count: string }[]; apiUsage: Record<string, unknown>[] }>('/api/admin/overview?' + qs({ days })),
  users: (p: { q?: string; plan?: string; blocked?: string; limit?: number; offset?: number }) => req<{ total: number; users: Record<string, unknown>[] }>('/api/admin/users?' + qs(Object.fromEntries(Object.entries(p).filter(function (e) { return e[1] !== undefined && e[1] !== ''; })) as Record<string, string | number>)),
  userDetail: (id: number) => req<{ user: Record<string, unknown>; settings: Record<string, unknown> | null; counts: Record<string, string> | null; recentEntries: Record<string, unknown>[]; recentAi: Record<string, unknown>[]; lastDays: { day: string; count: string }[] }>('/api/admin/users/' + id),
  patchUser: (id: number, patch: Record<string, unknown>) => req<unknown>('/api/admin/users/' + id, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteUser: (id: number) => req<{ ok: true }>('/api/admin/users/' + id, { method: 'DELETE' }),
  products: (p: { q?: string; source?: string; hidden?: string; limit?: number; offset?: number }) => req<{ total: number; products: Record<string, unknown>[] }>('/api/admin/products?' + qs(Object.fromEntries(Object.entries(p).filter(function (e) { return e[1] !== undefined && e[1] !== ''; })) as Record<string, string | number>)),
  patchProduct: (id: number, patch: Record<string, unknown>) => req<unknown>('/api/admin/products/' + id, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteProduct: (id: number) => req<{ ok: true }>('/api/admin/products/' + id, { method: 'DELETE' }),
  queries: (p: { status?: string; q?: string; limit?: number; offset?: number }) => req<{ total: number; queries: Record<string, unknown>[] }>('/api/admin/queries?' + qs(Object.fromEntries(Object.entries(p).filter(function (e) { return e[1] !== undefined && e[1] !== ''; })) as Record<string, string | number>)),
  retryQuery: (queryText: string) => req<{ ok: true }>('/api/admin/queries/retry', { method: 'POST', body: JSON.stringify({ query: queryText }) }),
  settings: () => req<{ settings: Record<string, unknown> }>('/api/admin/settings'),
  saveSetting: (key: string, value: unknown) => req<{ ok: true }>('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ key, value }) }),
  funnel: (p: { from?: string; to?: string; plan?: string; ai?: string; push?: string; staff?: number }) => req<{ filters: Record<string, unknown>; period: { from: string; to: string }; summary: Record<string, unknown>; funnel: { total: number; steps: { key: string; label: string; count: number; rate_prev: number | null; rate_first: number | null; independent: boolean }[] }; options: Record<string, { key: string; label: string; count: number }[]> }>('/api/admin/funnel?' + qs(Object.fromEntries(Object.entries(p).filter(function (e) { return e[1] !== undefined && e[1] !== ''; })) as Record<string, string | number>)),
  aiUsage: (days: number) => req<{ days: number; perDay: Record<string, unknown>[]; top: Record<string, unknown>[] }>('/api/admin/ai-usage?' + qs({ days })),
  payments: (p: { status?: string; limit?: number; offset?: number }) => req<{ total: number; payments: Record<string, unknown>[] }>('/api/admin/payments?' + qs(Object.fromEntries(Object.entries(p).filter(function (e) { return e[1] !== undefined && e[1] !== ''; })) as Record<string, string | number>)),
  paymentsSummary: () => req<{ byStatus: { status: string; count: string; total: string }[]; perMonth: { month: string; total: string; count: string }[] }>('/api/admin/payments/summary'),
  refundPayment: (id: number) => req<{ ok: true; revoked: boolean }>('/api/admin/payments/' + id + '/refund', { method: 'POST' }),
  subscriptions: (limit: number, offset: number) => req<{ total: number; subscriptions: Record<string, unknown>[] }>('/api/admin/subscriptions?' + qs({ limit, offset })),
  cancelSubscription: (userId: number) => req<{ ok: true }>('/api/admin/subscriptions/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) }),
  audit: (limit: number, offset: number) => req<{ total: number; log: Record<string, unknown>[] }>('/api/admin/audit?' + qs({ limit, offset })),
};
