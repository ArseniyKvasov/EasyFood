import { useMemo, useState } from 'react';
import { api } from '../api';
import { num } from '../lib/format';
import type { Product } from '../types';
import { Sheet } from './Sheet';
import { IconTrash } from './Icons';

type Props = {
  product: Product | null;
  prefill: { name?: string; barcode?: string };
  onSaved: (product: Product) => void;
  onDeleted: () => void;
  onBack: () => void;
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

export function ProductEditor({ product, prefill, onSaved, onDeleted, onBack }: Props) {
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

  const isOff = product?.source === 'off';

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

  const title = !product ? 'Новый продукт' : isOff ? 'Своя версия продукта' : 'Редактирование';

  return (
    <Sheet title={title} onClose={onBack} onBack={onBack}>
      {isOff && (
        <p className="hint" style={{ marginBottom: 14 }}>
          Данные Open Food Facts не меняются. Сохраните свою версию с правками — она будет
          использоваться вместо оригинала.
        </p>
      )}

      <label className="field-label" htmlFor="p-name">
        Название
      </label>
      <input
        id="p-name"
        className="field"
        value={form.name}
        placeholder="Например, гречка варёная"
        onChange={(e) => set('name')(e.target.value)}
      />

      <label className="field-label" style={{ marginTop: 12 }}>
        Значения на 100 г
      </label>
      <div className="grid-4">
        <div>
          <label className="field-label" htmlFor="p-kcal">
            Ккал
          </label>
          <input
            id="p-kcal"
            className="field"
            type="number"
            inputMode="decimal"
            value={form.kcal}
            onChange={(e) => set('kcal')(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="p-protein">
            Белки
          </label>
          <input
            id="p-protein"
            className="field"
            type="number"
            inputMode="decimal"
            value={form.protein}
            onChange={(e) => set('protein')(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="p-fat">
            Жиры
          </label>
          <input
            id="p-fat"
            className="field"
            type="number"
            inputMode="decimal"
            value={form.fat}
            onChange={(e) => set('fat')(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="p-carbs">
            Углеводы
          </label>
          <input
            id="p-carbs"
            className="field"
            type="number"
            inputMode="decimal"
            value={form.carbs}
            onChange={(e) => set('carbs')(e.target.value)}
          />
        </div>
      </div>

      <label className="field-label" htmlFor="p-serving" style={{ marginTop: 12 }}>
        Порция по умолчанию, г
      </label>
      <input
        id="p-serving"
        className="field"
        type="number"
        inputMode="decimal"
        value={form.servingG}
        onChange={(e) => set('servingG')(e.target.value)}
      />

      <label className="field-label" htmlFor="p-barcode" style={{ marginTop: 12 }}>
        Штрихкод (необязательно)
      </label>
      <input
        id="p-barcode"
        className="field"
        inputMode="numeric"
        value={form.barcode}
        onChange={(e) => set('barcode')(e.target.value)}
      />

      {warning && (
        <div className="notice" style={{ marginTop: 12 }}>
          {warning}
        </div>
      )}
      {error && (
        <div className="notice notice--danger" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      <button
        className="btn btn--block btn--lg"
        style={{ marginTop: 16 }}
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
        <button
          className="btn btn--danger btn--block"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={() => void remove()}
        >
          <IconTrash size={16} />
          Удалить продукт
        </button>
      )}
    </Sheet>
  );
}
