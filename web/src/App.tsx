import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { shiftDate, today } from './lib/date';
import { num } from './lib/format';
import type { Diary, Entry, MealId, Product, Settings, WeekDay } from './types';
import { Header } from './components/Header';
import { CalorieRing } from './components/CalorieRing';
import { MacroList } from './components/MacroList';
import { WeekStrip } from './components/WeekStrip';
import { MealCard } from './components/MealCard';
import { ProductPicker } from './components/ProductPicker';
import { GramsSheet } from './components/GramsSheet';
import { ProductEditor } from './components/ProductEditor';
import { SettingsSheet } from './components/SettingsSheet';
import { ToastHost, type ToastItem } from './components/Toast';
import { IconRefresh } from './components/Icons';

type SheetState =
  | { kind: 'picker'; meal: MealId }
  | { kind: 'grams'; product: Product; entryId: number | null; grams: number; meal: MealId }
  | { kind: 'editor'; product: Product | null; prefill: { name?: string; barcode?: string } }
  | { kind: 'settings' };

const MEAL_NAMES: Record<MealId, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
};

export default function App() {
  const [date, setDate] = useState(today());
  const [diary, setDiary] = useState<Diary | null>(null);
  const [week, setWeek] = useState<WeekDay[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stack, setStack] = useState<SheetState[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [productVersion, setProductVersion] = useState(0);
  const toastId = useRef(0);

  const pushToast = useCallback((text: string, action?: ToastItem['action']) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, action }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const load = useCallback(
    async (day: string, showSpinner = true) => {
      if (showSpinner) setLoading(true);
      setError(null);
      try {
        const [d, w, s] = await Promise.all([
          api.getDiary(day),
          api.getWeek(day),
          api.getSettings(),
        ]);
        setDiary(d);
        setWeek(w.days);
        setSettings(s);
      } catch {
        setError('Не удалось загрузить данные. Проверьте, что сервер запущен.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(date);
  }, [date, load]);

  // Тема
  useEffect(() => {
    const root = document.documentElement;
    if (settings?.theme === 'light' || settings?.theme === 'dark') {
      root.setAttribute('data-theme', settings.theme);
    } else {
      root.removeAttribute('data-theme');
    }
  }, [settings?.theme]);

  const targets = useMemo(
    () => ({
      kcal: settings?.kcal ?? 2100,
      protein: settings?.protein ?? 95,
      fat: settings?.fat ?? 65,
      carbs: settings?.carbs ?? 210,
    }),
    [settings],
  );

  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const closeAll = useCallback(() => setStack([]), []);

  const push = useCallback((sheet: SheetState) => setStack((s) => [...s, sheet]), []);

  // ---------- Действия ----------

  const addEntry = useCallback(
    async (product: Product, meal: MealId, grams: number) => {
      await api.createEntry({
        day: date,
        meal,
        productId: product.id > 0 ? product.id : null,
        name: product.name,
        grams,
        nutrition: {
          kcal: product.kcal,
          protein: product.protein,
          fat: product.fat,
          carbs: product.carbs,
        },
      });
      await load(date, false);
      closeAll();
      pushToast(`${product.name} · ${num(grams)} г добавлено`);
    },
    [date, load, closeAll, pushToast],
  );

  const updateEntry = useCallback(
    async (entry: Entry, grams: number) => {
      await api.updateEntry(entry.id, { grams });
      await load(date, false);
      closeAll();
      pushToast('Порция обновлена');
    },
    [date, load, closeAll, pushToast],
  );

  const deleteEntry = useCallback(
    async (entry: Entry) => {
      await api.deleteEntry(entry.id);
      await load(date, false);
      closeAll();
      pushToast(`${entry.name} удалена`, {
        label: 'Отменить',
        run: () => {
          void api
            .createEntry({
              day: entry.day,
              meal: entry.meal,
              productId: entry.productId,
              name: entry.name,
              grams: entry.grams,
              nutrition: entry.per100,
            })
            .then(() => load(date, false));
        },
      });
    },
    [date, load, closeAll, pushToast],
  );

  const productFromEntry = (entry: Entry): Product => ({
    id: entry.productId ?? 0,
    source: 'own',
    name: entry.name,
    kcal: entry.per100.kcal,
    protein: entry.per100.protein,
    fat: entry.per100.fat,
    carbs: entry.per100.carbs,
    servingG: entry.grams,
    barcode: '',
    useCount: 0,
  });

  // ---------- Рендер ----------

  const top = stack[stack.length - 1];

  const renderSheet = () => {
    if (!top) return null;

    if (top.kind === 'picker') {
      return (
        <ProductPicker
          meal={top.meal}
          mealName={MEAL_NAMES[top.meal]}
          refreshToken={productVersion}
          onPick={(p) =>
            push({
              kind: 'grams',
              product: p,
              entryId: null,
              grams: p.servingG || 100,
              meal: top.meal,
            })
          }
          onEdit={(p) => push({ kind: 'editor', product: p, prefill: {} })}
          onCreate={(prefill) => push({ kind: 'editor', product: null, prefill })}
          onClose={closeAll}
        />
      );
    }

    if (top.kind === 'grams') {
      const entry = top.entryId !== null ? diary?.meals.flatMap((m) => m.entries).find((e) => e.id === top.entryId) : null;
      return (
        <GramsSheet
          product={top.product}
          entryId={top.entryId}
          initialGrams={top.grams}
          mealName={MEAL_NAMES[top.meal]}
          onBack={pop}
          onSave={(grams) => {
            if (entry) void updateEntry(entry, grams);
            else void addEntry(top.product, top.meal, grams);
          }}
          onDelete={() => {
            if (entry) void deleteEntry(entry);
          }}
          onEditProduct={() => {
            const id = top.product.id;
            if (id > 0) {
              void api.getProduct(id).then((p) => push({ kind: 'editor', product: p, prefill: {} }));
            } else {
              push({ kind: 'editor', product: top.product, prefill: {} });
            }
          }}
        />
      );
    }

    if (top.kind === 'editor') {
      const below = stack[stack.length - 2];
      const originMeal: MealId = below && below.kind === 'picker' ? below.meal : 'snack';
      return (
        <ProductEditor
          product={top.product}
          prefill={top.prefill}
          onBack={pop}
          onSaved={(saved) => {
            setProductVersion((v) => v + 1);
            if (top.product) {
              setStack((s) => s.slice(0, -1));
              pushToast('Продукт сохранён');
            } else {
              setStack((s) => [
                ...s.slice(0, -1),
                {
                  kind: 'grams',
                  product: saved,
                  entryId: null,
                  grams: saved.servingG || 100,
                  meal: originMeal,
                },
              ]);
              pushToast('Продукт сохранён');
            }
          }}
          onDeleted={() => {
            setProductVersion((v) => v + 1);
            setStack((s) => s.slice(0, -1));
            pushToast('Продукт удалён');
          }}
        />
      );
    }

    return (
      <SettingsSheet
        settings={settings ?? { ...targets, theme: 'auto', onboarded: false }}
        onClose={closeAll}
        onSaved={(s) => {
          setSettings(s);
          closeAll();
          pushToast('Настройки сохранены');
          void load(date, false);
        }}
      />
    );
  };

  const totals = diary?.totals ?? { kcal: 0, protein: 0, fat: 0, carbs: 0 };

  return (
    <div className="app">
      <Header
        date={date}
        theme={settings?.theme ?? 'auto'}
        onPrev={() => setDate((d) => shiftDate(d, -1))}
        onNext={() => setDate((d) => shiftDate(d, 1))}
        onToday={() => setDate(today())}
        onTheme={() => {
          const order: Settings['theme'][] = ['auto', 'light', 'dark'];
          const current = settings?.theme ?? 'auto';
          const next = order[(order.indexOf(current) + 1) % order.length];
          setSettings((s) => (s ? { ...s, theme: next } : s));
          void api.updateSettings({ theme: next }).then((s) => setSettings(s));
        }}
        onSettings={() => push({ kind: 'settings' })}
      />

      <main className="main">
        {error && (
          <div className="banner" style={{ gridColumn: '1 / -1' }}>
            <IconRefresh />
            <span style={{ flex: 1 }}>{error}</span>
            <button className="btn btn--ghost" onClick={() => void load(date)}>
              Повторить
            </button>
          </div>
        )}

        <aside className="summary">
          <section className="card ring-card">
            <span className="label">Калории за день</span>
            {loading && !diary ? (
              <div className="skeleton" style={{ width: 216, height: 216, borderRadius: '50%', margin: 16 }} />
            ) : (
              <CalorieRing kcal={totals.kcal} target={targets.kcal} />
            )}
            <div className="kcal-figures">
              <div>
                <b>{num(totals.protein, 1)}</b>
                <span>белки, г</span>
              </div>
              <div>
                <b>{num(totals.fat, 1)}</b>
                <span>жиры, г</span>
              </div>
              <div>
                <b>{num(totals.carbs, 1)}</b>
                <span>углеводы, г</span>
              </div>
            </div>
          </section>

          <section className="card" style={{ padding: '18px 20px 20px' }}>
            <span className="label">Белки, жиры, углеводы</span>
            <div style={{ marginTop: 14 }}>
              <MacroList totals={totals} targets={targets} />
            </div>
          </section>

          <WeekStrip
            days={week}
            selected={date}
            target={targets.kcal}
            onSelect={(d) => setDate(d)}
          />
        </aside>

        <section className="meals">
          {loading && !diary
            ? [0, 1, 2, 3].map((i) => (
                <div key={i} className="card meal">
                  <div className="skeleton" style={{ height: 38, width: '60%' }} />
                  <div className="skeleton" style={{ height: 16, width: '85%', marginTop: 14 }} />
                  <div className="skeleton" style={{ height: 16, width: '70%', marginTop: 8 }} />
                </div>
              ))
            : (diary?.meals ?? []).map((meal) => (
                <MealCard
                  key={meal.id}
                  meal={meal}
                  onAdd={() => push({ kind: 'picker', meal: meal.id })}
                  onEditEntry={(entryId) => {
                    const entry = diary?.meals
                      .flatMap((m) => m.entries)
                      .find((e) => e.id === entryId);
                    if (!entry) return;
                    push({
                      kind: 'grams',
                      product: productFromEntry(entry),
                      entryId: entry.id,
                      grams: entry.grams,
                      meal: entry.meal,
                    });
                  }}
                />
              ))}
        </section>
      </main>

      {renderSheet()}
      <ToastHost items={toasts} onDismiss={dismissToast} />
    </div>
  );
}
