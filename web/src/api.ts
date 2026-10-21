import type { Diary, Entry, MonthSummary, Nutrition, Product, Recognition, Settings } from './types';

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

export const api = {
  // --- Аккаунт ---
  me: () => request<{ username: string }>('/api/auth/me'),

  login: (input: { username: string; password: string }) =>
    request<{ username: string }>('/api/auth/login', json(input)),

  register: (input: { username: string; password: string }) =>
    request<{ username: string }>('/api/auth/register', json(input)),

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

  /** Единый поиск: своя база + Nutriapix. `more` — есть смысл догрузить Open Food Facts. */
  searchProducts: (q: string) =>
    request<{ products: Product[]; more: boolean }>(
      `/api/products/search?q=${encodeURIComponent(q)}`,
    ),

  /** Подсказки для поиска. */
  productHints: (q: string) =>
    request<{ hints: string[] }>(`/api/products/hints?q=${encodeURIComponent(q)}`),

  /** Забирает КБЖУ из Nutriapix и сохраняет продукт в каталог. */
  hydrateProduct: (slug: string) =>
    request<{ product: Product }>(`/api/products/external/nutriapix/${encodeURIComponent(slug)}`),

  getProduct: (id: number) => request<Product>(`/api/products/${id}`),

  getPortions: (id: number) =>
    request<{ portions: { grams: number; uses: number }[] }>(`/api/products/${id}/portions`),

  getRemoteProducts: (q: string) =>
    request<{ products: Product[] }>(`/api/products/remote?q=${encodeURIComponent(q)}`),

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

  /** Настроено ли S3-хранилище: если да — картинки идут напрямую в бакет. */
  uploadStatus: () => request<{ enabled: boolean }>('/api/uploads/status'),

  /** Подписанная ссылка на загрузку: браузер кладёт файл прямо в S3. */
  presignUpload: (input: { contentType: string; size: number }) =>
    request<{ key: string; uploadUrl: string; contentType: string; expiresIn: number }>(
      '/api/uploads/presign',
      json(input),
    ),

  /** Удалить загруженный файл — например, если распознавание не удалось. */
  deleteUpload: (key: string) =>
    request<{ ok: true }>(`/api/uploads?key=${encodeURIComponent(key)}`, { method: 'DELETE' }),

  recognize: (input: { key?: string; image?: string; note?: string }) =>
    request<Recognition>('/api/recognize', json(input)),

  recognizeByText: (description: string) =>
    request<Recognition>('/api/recognize/text', json({ description })),
};
