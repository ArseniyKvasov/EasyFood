import { num } from '../lib/format';
import type { MealBucket } from '../types';
import { IconChevronRight, IconPlus, IconPlate } from './Icons';

type Props = {
  meal: MealBucket;
  onAdd: () => void;
  onEditEntry: (entryId: number) => void;
};

export function MealCard({ meal, onAdd, onEditEntry }: Props) {
  return (
    <article className="card meal">
      <header className="meal__head">
        <span className="meal__emoji" aria-hidden="true">
          {meal.emoji}
        </span>
        <div>
          <div className="meal__name">{meal.name}</div>
          <div className="meal__meta">
            {meal.entries.length ? `${meal.entries.length} записи` : 'ничего не добавлено'}
          </div>
        </div>
        <div className="meal__kcal">
          {num(meal.kcal)}
          <small>ккал</small>
        </div>
      </header>

      <div className="meal__list">
        {meal.entries.length === 0 ? (
          <div className="empty">
            <span className="empty__icon">
              <IconPlate />
            </span>
            Пока пусто
          </div>
        ) : (
          meal.entries.map((e) => (
            <button key={e.id} className="entry" onClick={() => onEditEntry(e.id)}>
              <span className="entry__body">
                <span className="entry__name">{e.name}</span>
                <span className="entry__meta">
                  {num(e.grams)} г · Б {num(e.nutrition.protein, 1)} · Ж {num(e.nutrition.fat, 1)} · У{' '}
                  {num(e.nutrition.carbs, 1)}
                </span>
              </span>
              <span className="entry__kcal">{num(e.nutrition.kcal)}</span>
              <span className="entry__chev">
                <IconChevronRight size={16} />
              </span>
            </button>
          ))
        )}
      </div>

      <button className="add-btn" onClick={onAdd}>
        <IconPlus size={16} />
        Добавить продукт
      </button>
    </article>
  );
}
