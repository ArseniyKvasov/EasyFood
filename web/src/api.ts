import type {
  Diary,
  Entry,
  MonthSummary,
  Nutrition,
  Product,
  Recognition,
  Settings,
  User,
} from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    let code = 'ERROR';
    let message = `Ошибка ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      code = data.error ?? code;
      message = data.message ?? message;
    } catch {
      /* тело ответа не JSON — оставляем текст по умолчанию */
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
});

/** Вход через Яндекс ID: сервер сам уводит на страницу согласия. */
export const YANDEX_SIGN_IN_URL = '/api/auth/yandex/start';

/**
 * Куда уводим пользователя без сессии. Приложение доступно только авторизованным,
 * остальные видят лендинг. Адрес задаётся через VITE_LANDING_URL.
 */
export const LANDING_URL: string = import.meta.env.VITE_LANDING_URL || '/';

export const api = {
  // --- Аккаунт ---
  me: () => request<User>('/api/auth/me'),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  getDiary: (date: string) => request<Diary>(`/api/diary?date=${date}`),

  getMonth: (month: string) =>
    request<MonthSummary>(`/api/diary/month?month=${encodeURIComponent(month)}`),

  createEntry: (input: {
    day: string;
    meal: Entry['meal'];
    productId?: number | null;
    name: string;
    grams: number;
    nutrition: Nutrition;
  }) => request<{ id: number }>('/api/entries', json(input)),

  updateEntry: (id: number, patch: { grams?: number; name?: string }) =>
    request<{ id: number }>(`/api/entries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  deleteEntry: (id: number) => request<{ ok: true }>(`/api/entries/${id}`, { method: 'DELETE' }),

  getProducts: (q = '') =>
    request<{ products: Product[] }>(`/api/products?q=${encodeURIComponent(q)}`),

  /** Единый поиск: своя база + Perek. */
  searchProducts: (q: string) =>
    request<{ products: Product[] }>(`/api/products/search?q=${encodeURIComponent(q)}`),

  /** Подсказки для поиска. */
  productHints: (q: string) =>
    request<{ hints: string[] }>(`/api/products/hints?q=${encodeURIComponent(q)}`),

  getProduct: (id: number) => request<Product>(`/api/products/${id}`),

  getPortions: (id: number) =>
    request<{ portions: { grams: number; uses: number }[] }>(`/api/products/${id}/portions`),

  getProductByBarcode: (code: string) =>
    request<{ product: Product; origin: string }>(`/api/products/barcode/${code}`),

  createProduct: (input: {
    name: string;
    kcal: number;
    protein: number;
    fat: number;
    carbs: number;
    servingG?: number;
    barcode?: string;
    source?: 'own' | 'ai';
  }) => request<Product>('/api/products', json(input)),

  updateProduct: (id: number, input: Partial<Product>) =>
    request<Product>(`/api/products/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  deleteProduct: (id: number) => request<{ ok: true }>(`/api/products/${id}`, { method: 'DELETE' }),

  getSettings: () => request<Settings>('/api/settings'),

  updateSettings: (patch: Partial<Settings>) =>
    request<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  aiStatus: () => request<{ enabled: boolean }>('/api/recognize/status'),

  /** Фото уходит в теле запроса как data URL (base64) — хранилища нет. */
  recognize: (input: { image: string; note?: string }) =>
    request<Recognition>('/api/recognize', json(input)),

  // --- Напоминания (Web Push) ---
  pushStatus: () => request<{ enabled: boolean; subscribed: boolean }>('/api/push/status'),

  pushPublicKey: () => request<{ key: string }>('/api/push/public-key'),

  pushSubscribe: (subscription: PushSubscriptionJSON) =>
    request<{ ok: true }>('/api/push/subscribe', json({ subscription })),

  recognizeByText: (description: string) =>
    request<Recognition>('/api/recognize/text', json({ description })),

  // --- Подписка Plus ---
  billingStatus: () =>
    request<{
      plus: boolean;
      plan: string;
      status: string | null;
      current_end: string | null;
      cancel_at: string | null;
      has_rebill: boolean;
      email: string;
      quota: { plus: boolean; limit: number; used: number; period: string };
      prices: { month: number; year: number };
      tbank: boolean;
    }>('/api/billing/status'),

  checkout: (plan: 'month' | 'year') =>
    request<{ paymentUrl: string; orderId: string }>('/api/checkout', json({ plan })),

  cancelSubscription: () =>
    request<{ ok: true; current_end: string | null }>('/api/billing/cancel', {
      method: 'POST',
    }),

  syncBilling: () =>
    request<{ ok: true; status: string }>('/api/billing/sync', { method: 'POST' }),

  // --- Тренды и экспорт (Plus) ---
  trends: (days: number) =>
    request<{
      from: string;
      to: string;
      days: { day: string; entries: number; kcal: number; protein: number; fat: number; carbs: number }[];
      targets: { kcal: number; protein: number; fat: number; carbs: number };
      summary: {
        activeDays: number;
        totalDays: number;
        avgKcal: number;
        avgProtein: number;
        avgFat: number;
        avgCarbs: number;
        streak: number;
        inNormDays: number;
        overDays: number;
      };
    }>(`/api/trends?days=${days}`),

  diaryRange: (from: string, to: string) =>
    request<{
      from: string;
      to: string;
      entries: { day: string; meal: string; name: string; grams: string; kcal: string; protein: string; fat: string; carbs: string }[];
    }>(`/api/diary/range?from=${from}&to=${to}`),

  exportCsv: async (from: string, to: string): Promise<void> => {
    const res = await fetch(`/api/export.csv?from=${from}&to=${to}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) {
      let code = 'ERROR';
      let message = `Ошибка ${res.status}`;
      try {
        const data = (await res.json()) as { error?: string; message?: string };
        code = data.error ?? code;
        message = data.message ?? message;
      } catch {
        /* не JSON */
      }
      throw new ApiError(res.status, code, message);
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m = /filename="([^"]+)"/.exec(cd);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = m ? m[1] : 'bitebalance.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};
