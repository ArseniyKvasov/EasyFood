import { useEffect, useMemo, useState } from 'react';
import { num } from '../lib/format';
import type { Product } from '../types';
import { IconPencil, IconTrash } from './Icons';

type Props = {
  product: Product;
  entryId: number | null;
  initialGrams: number;
  mealName: string;
  onSave: (grams: number) => void;
  onDelete: () => void;
  onEditProduct: () => void;
};

export function GramsSheet({
  product,
  entryId,
  initialGrams,
  mealName,
  onSave,
  onDelete,
  onEditProduct,
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
    <>
      <label className="form-label" htmlFor="grams">
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
          className="form-control"
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
          <button key={p} className="chip" aria-pressed={p === grams} onClick={() => setGrams(p)}>
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

      <div className="action-row">
        <button
          className="btn btn-primary btn-lg flex-grow-1"
          disabled={!(grams > 0)}
          onClick={() => onSave(grams)}
        >
          {editing ? 'Сохранить' : `Добавить в «${mealName}»`}
        </button>
        <button
          className="btn btn-outline-secondary btn-icon"
          onClick={onEditProduct}
          aria-label="Изменить продукт"
          title="Изменить продукт"
        >
          <IconPencil size={18} />
        </button>
        {editing && (
          <button
            className="btn btn-danger-soft btn-icon"
            onClick={onDelete}
            aria-label="Удалить из дневника"
            title="Удалить из дневника"
          >
            <IconTrash size={18} />
          </button>
        )}
      </div>
    </>
  );
}
