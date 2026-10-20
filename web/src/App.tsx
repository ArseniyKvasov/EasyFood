import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { shiftDate, today } from './lib/date';
import { num } from './lib/format';
import type { Diary, Entry, MealId, Product, Settings } from './types';
import { Header } from './components/Header';
import { CalorieRing } from './components/CalorieRing';
import { MacroList } from './components/MacroList';
import { MealCard } from './components/MealCard';
import { ProductPicker } from './components/ProductPicker';
import { GramsSheet } from './components/GramsSheet';
import { ProductEditor } from './components/ProductEditor';
import { SettingsSheet } from './components/SettingsSheet';
import { Sheet } from './components/Sheet';
import { AuthScreen } from './components/AuthScreen';
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
  const [user, setUser] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [date, setDate] = useState(today());
  const [diary, setDiary] = useState<Diary | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stack, setStack] = useState<SheetState[]>([]);
  const [closing, setClosing] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [productVersion, setProductVersion] = useState(0);
  const toastId = useRef(0);
  const closeTimer = useRef<number | undefined>(undefined);

  // Проверяем сессию при старте
  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.username))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  const pushToast = useCallback((text: string, action?: ToastItem['action']) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, action }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const load = useCallback(async (day: string, showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const [d, s] = await Promise.all([api.getDiary(day), api.getSettings()]);
      setDiary(d);
      setSettings(s);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        return;
      }
      setError('Не удалось загрузить данные. Проверьте, что сервер запущен.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void load(date);
  }, [date, load, user]);

  // Тема
  useEffect(() => {
    const root = document.documentElement;
    if (settings?.theme === 'light' || settings?.theme === 'dark') {
      root.setAttribute('data-theme', settings.theme);
    } else {
      root.removeAttribute('data-theme');
    }
  }, [settings?.theme]);

  // Блокируем прокрутку страницы, пока открыта шторка
  useEffect(() => {
    const open = stack.length > 0;
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [stack.length]);

  const targets = useMemo(
    () => ({
      kcal: settings?.kcal ?? 2100,
      protein: settings?.protein ?? 95,
      fat: settings?.fat ?? 65,
      carbs: settings?.carbs ?? 210,
    }),
    [settings],
  );

  const closeAll = useCallback(() => {
    setStack((s) => {
      if (!s.length) return s;
      setClosing(true);
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => {
        setStack([]);
        setClosing(false);
      }, 180);
      return s;
    });
  }, []);

  const pop = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const push = useCallback((sheet: SheetState) => {
    setClosing(false);
    setStack((s) => [...s, sheet]);
  }, []);

  // Escape закрывает верхний шаг
  useEffect(() => {
    if (!stack.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (stack.length > 1) pop();
        else closeAll();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stack.length, pop, closeAll]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

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

  // ---------- Рендер шагов ----------

  const top = stack[stack.length - 1];

  const editorTitle = (product: Product | null) =>
    !product ? 'Новый продукт' : product.source === 'off' ? 'Своя версия' : 'Редактирование';

  const renderSheet = () => {
    if (!top) return null;

    if (top.kind === 'picker') {
      return (
        <Sheet title={`Добавить в «${MEAL_NAMES[top.meal]}»`} onClose={closeAll}>
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
          />
        </Sheet>
      );
    }

    if (top.kind === 'grams') {
      const entry =
        top.entryId !== null
          ? diary?.meals.flatMap((m) => m.entries).find((e) => e.id === top.entryId)
          : null;
      return (
        <Sheet title={top.product.name} onClose={closeAll} onBack={pop}>
          <GramsSheet
            product={top.product}
            entryId={top.entryId}
            initialGrams={top.grams}
            mealName={MEAL_NAMES[top.meal]}
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
                void api
                  .getProduct(id)
                  .then((p) => push({ kind: 'editor', product: p, prefill: {} }))
                  .catch(() => push({ kind: 'editor', product: top.product, prefill: {} }));
              } else {
                push({ kind: 'editor', product: top.product, prefill: {} });
              }
            }}
          />
        </Sheet>
      );
    }

    if (top.kind === 'editor') {
      const below = stack[stack.length - 2];
      const originMeal: MealId = below && below.kind === 'picker' ? below.meal : 'snack';
      return (
        <Sheet title={editorTitle(top.product)} onClose={closeAll} onBack={pop}>
          <ProductEditor
            product={top.product}
            prefill={top.prefill}
            onSaved={(saved) => {
              setProductVersion((v) => v + 1);
              if (top.product) {
                pop();
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
              pop();
              pushToast('Продукт удалён');
            }}
          />
        </Sheet>
      );
    }

    return (
      <Sheet title="Настройки" onClose={closeAll}>
        <SettingsSheet
          settings={settings ?? { ...targets, theme: 'auto', onboarded: false }}
          username={user ?? ''}
          onSaved={(s) => {
            setSettings(s);
            closeAll();
            pushToast('Настройки сохранены');
            void load(date, false);
          }}
          onLogout={() => {
            void api.logout().finally(() => {
              setUser(null);
              setDiary(null);
              setSettings(null);
            });
          }}
        />
      </Sheet>
    );
  };

  const totals = diary?.totals ?? { kcal: 0, protein: 0, fat: 0, carbs: 0 };

  if (!authChecked) {
    return (
      <div className="auth">
        <span className="spinner" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        onAuthed={(username) => {
          setUser(username);
          setAuthChecked(true);
        }}
      />
    );
  }

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

      <main className="main container-xxl">
        {error && (
          <div className="banner">
            <IconRefresh />
            <span className="flex-grow-1">{error}</span>
            <button className="btn btn-outline-secondary btn-sm" onClick={() => void load(date)}>
              Повторить
            </button>
          </div>
        )}

        <div className="row g-4 mt-4">
          <div className="col-12 col-lg-5 col-xl-4">
            <div className="summary">
              <section className="card ring-card">
                <div className="card-body">
                  <p className="ef-label">Калории</p>
                  {loading && !diary ? (
                    <div
                      className="skeleton"
                      style={{ width: 212, height: 212, borderRadius: '50%', margin: '1.5rem auto 0' }}
                    />
                  ) : (
                    <CalorieRing kcal={totals.kcal} target={targets.kcal} />
                  )}
                  <MacroList totals={totals} targets={targets} />
                </div>
              </section>
            </div>
          </div>

          <div className="col-12 col-lg-7 col-xl-8">
            <div className="row g-4">
              {loading && !diary
                ? [0, 1, 2, 3].map((i) => (
                    <div className="col-12 col-xl-6" key={i}>
                      <div className="card h-100">
                        <div className="card-body">
                          <div className="skeleton" style={{ height: 26, width: '45%' }} />
                          <div className="skeleton" style={{ height: 16, width: '85%', marginTop: 18 }} />
                          <div className="skeleton" style={{ height: 16, width: '65%', marginTop: 10 }} />
                        </div>
                      </div>
                    </div>
                  ))
                : (diary?.meals ?? []).map((meal) => (
                    <div className="col-12 col-xl-6" key={meal.id}>
                      <MealCard
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
                    </div>
                  ))}
            </div>
          </div>
        </div>
      </main>

      {top && (
        <>
          <div className={`modal-backdrop fade${closing ? '' : ' show'}`} />
          <div
            className={`modal fade${closing ? '' : ' show'}`}
            style={{ display: 'block' }}
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeAll();
            }}
          >
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">{renderSheet()}</div>
            </div>
          </div>
        </>
      )}

      <ToastHost items={toasts} onDismiss={dismissToast} />
    </div>
  );
}
