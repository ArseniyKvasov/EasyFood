import { Suspense, lazy, useMemo, useState } from 'react';
import { api } from '../api';
import { num } from '../lib/format';
import type { Product } from '../types';
import { IconBarcode, IconTrash } from './Icons';

// ZXing грузим лениво — сканер нужен не всегда.
const BarcodeScanner = lazy(() =>
  import('./BarcodeScanner').then((m) => ({ default: m.BarcodeScanner })),
);

type Props = {
  product: Product | null;
  prefill: { name?: string; barcode?: string };
  onSaved: (product: Product) => void;
  onDeleted: () => void;
};

type Form = {
  name: string;
  kcal: string;
  protein: string;
  fat: string;
  carbs: string;
  servingG: string;
  barcode: string;
};

const emptyForm = (prefill: { name?: string; barcode?: string }): Form => ({
  name: prefill.name ?? '',
  kcal: '',
  protein: '',
  fat: '',
  carbs: '',
  servingG: '100',
  barcode: prefill.barcode ?? '',
});

export function ProductEditor({ product, prefill, onSaved, onDeleted }: Props) {
  const [form, setForm] = useState<Form>(() =>
    product
      ? {
          name: product.name,
          kcal: String(product.kcal),
          protein: String(product.protein),
          fat: String(product.fat),
          carbs: String(product.carbs),
          servingG: String(product.servingG),
          barcode: product.barcode,
        }
      : emptyForm(prefill),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const set = (key: keyof Form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const numbers = useMemo(() => {
    const parse = (v: string) => (v === '' ? NaN : Number(v));
    return {
      kcal: parse(form.kcal),
      protein: parse(form.protein),
      fat: parse(form.fat),
      carbs: parse(form.carbs),
    };
  }, [form]);

  const { warning, valid } = useMemo(() => {
    const { kcal, protein, fat, carbs } = numbers;
    const all = [kcal, protein, fat, carbs];
    if (all.some((n) => Number.isNaN(n))) return { warning: '', valid: false };
    const sum = protein + fat + carbs;
    if (sum > 100) {
      return {
        warning: 'Белок, жиры и углеводы вместе не могут превышать 100 г на 100 г.',
        valid: false,
      };
    }
    const computed = 4 * protein + 9 * fat + 4 * carbs;
    const diff = Math.abs(kcal - computed);
    const msg =
      diff > Math.max(15, 0.15 * kcal)
        ? `По БЖУ выходит около ${num(computed)} ккал, а указано ${num(kcal)}. Проверьте значения.`
        : '';
    const ok =
      form.name.trim().length > 0 &&
      all.every((n) => !Number.isNaN(n) && n >= 0) &&
      kcal <= 900 &&
      sum <= 100 &&
      Number(form.servingG) > 0;
    return { warning: msg, valid: ok };
  }, [numbers, form.name, form.servingG]);

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        kcal: Number(numbers.kcal),
        protein: Number(numbers.protein),
        fat: Number(numbers.fat),
        carbs: Number(numbers.carbs),
        servingG: Number(form.servingG) || 100,
        barcode: form.barcode.trim(),
        source: (product?.source === 'ai' ? 'ai' : 'own') as 'own' | 'ai',
      };
      const saved = product
        ? await api.updateProduct(product.id, payload)
        : await api.createProduct(payload);
      onSaved(saved);
    } catch {
      setError('Не удалось сохранить продукт. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!product) return;
    setBusy(true);
    try {
      await api.deleteProduct(product.id);
      onDeleted();
    } catch {
      setError('Не удалось удалить продукт.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label className="form-label" htmlFor="p-name">
        Название
      </label>
      <input
        id="p-name"
        className="form-control mb-3"
        value={form.name}
        placeholder="Например, гречка варёная"
        onChange={(e) => set('name')(e.target.value)}
      />

      <span className="form-label d-block">Значения на 100 г</span>
      <div className="row g-2">
        <div className="col-3">
          <label className="form-label" htmlFor="p-kcal">
            Ккал
          </label>
          <input
            id="p-kcal"
            className="form-control text-center"
            type="number"
            inputMode="decimal"
            value={form.kcal}
            onChange={(e) => set('kcal')(e.target.value)}
          />
        </div>
        <div className="col-3">
          <label className="form-label" htmlFor="p-protein">
            Белки
          </label>
          <input
            id="p-protein"
            className="form-control text-center"
            type="number"
            inputMode="decimal"
            value={form.protein}
            onChange={(e) => set('protein')(e.target.value)}
          />
        </div>
        <div className="col-3">
          <label className="form-label" htmlFor="p-fat">
            Жиры
          </label>
          <input
            id="p-fat"
            className="form-control text-center"
            type="number"
            inputMode="decimal"
            value={form.fat}
            onChange={(e) => set('fat')(e.target.value)}
          />
        </div>
        <div className="col-3">
          <label className="form-label" htmlFor="p-carbs">
            Углеводы
          </label>
          <input
            id="p-carbs"
            className="form-control text-center"
            type="number"
            inputMode="decimal"
            value={form.carbs}
            onChange={(e) => set('carbs')(e.target.value)}
          />
        </div>
      </div>

      <label className="form-label mt-3" htmlFor="p-serving">
        Порция по умолчанию, г
      </label>
      <input
        id="p-serving"
        className="form-control"
        type="number"
        inputMode="decimal"
        value={form.servingG}
        onChange={(e) => set('servingG')(e.target.value)}
      />

      <label className="form-label mt-3" htmlFor="p-barcode">
        Штрихкод (необязательно)
      </label>
      <div className="input-with-btn">
        <input
          id="p-barcode"
          className="form-control"
          inputMode="numeric"
          value={form.barcode}
          onChange={(e) => set('barcode')(e.target.value)}
        />
        <button
          type="button"
          className="input-with-btn__btn"
          onClick={() => setScanning((v) => !v)}
          aria-label="Сканировать штрихкод"
          title="Сканировать штрихкод"
        >
          <IconBarcode size={18} />
        </button>
      </div>

      {scanning && (
        <div className="scanner mt-2">
          <Suspense
            fallback={
              <div className="scanner__placeholder">Запускаем камеру…</div>
            }
          >
            <BarcodeScanner
              onDetected={(code) => {
                set('barcode')(code);
                setScanning(false);
              }}
            />
          </Suspense>
        </div>
      )}

      {warning && <div className="alert alert-warning mt-3 mb-0">{warning}</div>}
      {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}

      <button
        className="btn btn-primary btn-lg w-100 mt-4"
        disabled={!valid || busy}
        onClick={() => void save()}
      >
        {busy ? (
          <>
            <span className="spinner" />
            Сохраняем…
          </>
        ) : product ? (
          'Сохранить изменения'
        ) : (
          'Сохранить как мой продукт'
        )}
      </button>

      {product && product.source === 'own' && (
        <button className="btn btn-danger-soft w-100 mt-2" disabled={busy} onClick={() => void remove()}>
          <IconTrash size={16} />
          Удалить продукт
        </button>
      )}
    </>
  );
}
