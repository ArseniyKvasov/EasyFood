import type { Diary, Entry, Nutrition, Product, Recognition, Settings } from './types';

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

  getProduct: (id: number) => request<Product>(`/api/products/${id}`),

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

  recognize: (image: string, note?: string) =>
    request<Recognition>('/api/recognize', json({ image, note })),
};
