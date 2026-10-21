import { num } from '../lib/format';
import type { MealBucket } from '../types';
import { IconPlus, IconPlate } from './Icons';

type Props = {
  meal: MealBucket;
  onAdd: () => void;
  onEditEntry: (entryId: number) => void;
};

export function MealCard({ meal, onAdd, onEditEntry }: Props) {
  return (
    <article className="card meal h-100">
      <div className="card-body">
        <header className="meal__head">
          <h3 className="meal__name">{meal.name}</h3>
          <div className="meal__kcal">{num(meal.kcal)} ккал</div>
        </header>

        {meal.entries.length === 0 ? (
          <div className="empty">
            <span className="empty__icon">
              <IconPlate />
            </span>
            <span>Пока пусто</span>
          </div>
        ) : (
          <div className="list-group list-group-flush">
            {meal.entries.map((e) => (
              <button
                key={e.id}
                className="list-group-item list-group-item-action"
                onClick={() => onEditEntry(e.id)}
              >
                <span className="entry">
                  <span className="entry__body">
                    <span className="entry__name">{e.name}</span>
                    <span className="entry__meta">
                      {num(e.grams)} г · Б {num(e.nutrition.protein, 1)} · Ж {num(e.nutrition.fat, 1)} · У{' '}
                      {num(e.nutrition.carbs, 1)}
                    </span>
                  </span>
                  <span className="entry__kcal">{num(e.nutrition.kcal, 1)}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="meal__actions">
          <button className="add-btn" onClick={onAdd}>
            <IconPlus size={16} />
            Добавить продукт
          </button>
        </div>
      </div>
    </article>
  );
}
