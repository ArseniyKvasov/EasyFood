import { useEffect, useMemo, useState } from 'react';
import { num } from '../lib/format';
import type { Product } from '../types';
import { Sheet } from './Sheet';
import { IconPencil, IconTrash } from './Icons';

type Props = {
  product: Product;
  entryId: number | null;
  initialGrams: number;
  mealName: string;
  onSave: (grams: number) => void;
  onDelete: () => void;
  onEditProduct: () => void;
  onBack: () => void;
};

export function GramsSheet({
  product,
  entryId,
  initialGrams,
  mealName,
  onSave,
  onDelete,
  onEditProduct,
  onBack,
}: Props) {
  const [grams, setGrams] = useState(initialGrams);

  useEffect(() => setGrams(initialGrams), [initialGrams, product.id]);

  const value = useMemo(() => {
    const k = grams / 100;
    return {
      kcal: product.kcal * k,
      protein: product.protein * k,
      fat: product.fat * k,
      carbs: product.carbs * k,
    };
  }, [grams, product]);

  const presets = useMemo(
    () =>
      [...new Set([product.servingG, 50, 100, 150, 200, 250].filter((v) => v > 0))].sort(
        (a, b) => a - b,
      ),
    [product.servingG],
  );

  const editing = entryId !== null;

  return (
    <Sheet
      title={product.name}
      onClose={onBack}
      onBack={onBack}
    >
      <p className="hint" style={{ marginBottom: 14 }}>
        На 100 г: {num(product.kcal)} ккал · Б {num(product.protein, 1)} · Ж {num(product.fat, 1)} · У{' '}
        {num(product.carbs, 1)}
      </p>

      <label className="field-label" htmlFor="grams">
        Порция, г
      </label>
      <div className="grams-input">
        <button
          className="stepper"
          onClick={() => setGrams((g) => Math.max(0, g - 10))}
          aria-label="Уменьшить на 10 грамм"
        >
          −
        </button>
        <input
          id="grams"
          className="field"
          type="number"
          inputMode="decimal"
          min={0}
          max={5000}
          value={grams}
          onChange={(e) => setGrams(Number(e.target.value))}
        />
        <button
          className="stepper"
          onClick={() => setGrams((g) => Math.min(5000, g + 10))}
          aria-label="Увеличить на 10 грамм"
        >
          +
        </button>
      </div>

      <div className="chips">
        {presets.map((p) => (
          <button
            key={p}
            className="chip"
            aria-pressed={p === grams}
            onClick={() => setGrams(p)}
          >
            {p} г
          </button>
        ))}
      </div>

      <div className="portion-preview">
        <div>
          <b>{num(value.kcal)}</b>
          <span>ккал</span>
        </div>
        <div>
          <b>{num(value.protein, 1)}</b>
          <span>белок</span>
        </div>
        <div>
          <b>{num(value.fat, 1)}</b>
          <span>жиры</span>
        </div>
        <div>
          <b>{num(value.carbs, 1)}</b>
          <span>углеводы</span>
        </div>
      </div>

      <button
        className="btn btn--block btn--lg"
        disabled={!(grams > 0)}
        onClick={() => onSave(grams)}
      >
        {editing ? 'Сохранить' : `Добавить в «${mealName}»`}
      </button>

      {editing && (
        <button className="btn btn--danger btn--block" style={{ marginTop: 8 }} onClick={onDelete}>
          <IconTrash size={16} />
          Удалить из дневника
        </button>
      )}

      <button className="btn btn--ghost btn--block" style={{ marginTop: 8 }} onClick={onEditProduct}>
        <IconPencil size={16} />
        Изменить продукт
      </button>
    </Sheet>
  );
}
