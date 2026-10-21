import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api';
import { fileToDataUrl } from '../lib/image';
import { num } from '../lib/format';
import type { MealId, Product, Recognition } from '../types';
import {
  IconBarcode,
  IconCamera,
  IconCheck,
  IconImage,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSparkles,
} from './Icons';

// ZXing весит заметно — грузим только когда пользователь открывает вкладку со сканером.
const BarcodeScanner = lazy(() =>
  import('./BarcodeScanner').then((m) => ({ default: m.BarcodeScanner })),
);

type Tab = 'search' | 'barcode' | 'photo' | 'text';

/** Ограничение на текстовое описание блюда. */
const NOTE_MAX_LENGTH = 500;

type Props = {
  meal: MealId;
  mealName: string;
  refreshToken: number;
  onPick: (product: Product) => void;
  onEdit: (product: Product) => void;
  onCreate: (prefill: { name?: string; barcode?: string }) => void;
};

export function ProductPicker({
  meal,
  mealName,
  refreshToken,
  onPick,
  onEdit,
  onCreate,
}: Props) {
  const [tab, setTab] = useState<Tab>('search');
  const [query, setQuery] = useState('');
  const [local, setLocal] = useState<Product[]>([]);
  const [remote, setRemote] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  const [code, setCode] = useState('');
  const [codeMiss, setCodeMiss] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);

  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [recognizing, setRecognizing] = useState(false);
  const [recognition, setRecognition] = useState<Recognition | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    api
      .aiStatus()
      .then((s) => setAiEnabled(s.enabled))
      .catch(() => setAiEnabled(false));
  }, []);

  // Поиск: локальная база + Open Food Facts как дополнение.
  useEffect(() => {
    const q = query.trim();
    const id = ++requestId.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const own = await api.getProducts(q);
        if (id !== requestId.current) return;
        setLocal(own.products);
        if (q.length >= 2) {
          try {
            const res = await api.getRemoteProducts(q);
            if (id !== requestId.current) return;
            setRemote(res.products);
          } catch {
            if (id === requestId.current) setRemote([]);
          }
        } else {
          setRemote([]);
        }
      } catch {
        if (id === requestId.current) setLocal([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query, refreshToken]);

  const results = useMemo(() => {
    const seen = new Set(local.map((p) => p.id));
    return [...local, ...remote.filter((p) => !seen.has(p.id))];
  }, [local, remote]);

  const lookupCode = useCallback(
    async (raw: string) => {
      const value = raw.replace(/\D/g, '');
      if (value.length < 8) {
        setCodeMiss(raw);
        return;
      }
      setCodeBusy(true);
      setCodeMiss(null);
      try {
        const res = await api.getProductByBarcode(value);
        onPick(res.product);
      } catch {
        setCodeMiss(value);
      } finally {
        setCodeBusy(false);
      }
    },
    [onPick],
  );

  const pickPhoto = async (file: File) => {
    setAiError(null);
    setRecognition(null);
    try {
      setPhoto(await fileToDataUrl(file));
    } catch {
      setAiError('Не удалось прочитать файл.');
    }
  };

  const recognizePhoto = async () => {
    if (!photo) return;
    setRecognizing(true);
    setAiError(null);
    try {
      setRecognition(await api.recognize(photo));
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : 'Распознавание не удалось.');
    } finally {
      setRecognizing(false);
    }
  };

  const recognizeText = async () => {
    const text = note.trim();
    if (!text) return;
    setRecognizing(true);
    setAiError(null);
    try {
      setRecognition(await api.recognizeByText(text));
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : 'Распознавание не удалось.');
    } finally {
      setRecognizing(false);
    }
  };

  const useRecognition = async () => {
    if (!recognition) return;
    const product = await api.createProduct({
      name: recognition.name,
      kcal: Math.round(recognition.nutrition.kcal),
      protein: Math.round(recognition.nutrition.protein * 10) / 10,
      fat: Math.round(recognition.nutrition.fat * 10) / 10,
      carbs: Math.round(recognition.nutrition.carbs * 10) / 10,
      servingG: recognition.grams,
      source: 'ai',
    });
    onPick({ ...product, servingG: recognition.grams });
  };

  const body = () => {
    if (tab === 'barcode') {
      return (
        <>
          <BarcodePane
            code={code}
            busy={codeBusy}
            onCode={setCode}
            onDetect={(v) => {
              setCode(v);
              void lookupCode(v);
            }}
            onSubmit={() => void lookupCode(code)}
          />
          {codeMiss && (
            <>
              <div className="alert alert-danger mt-3 mb-0">
                Продукт со штрихкодом {codeMiss} не найден. Добавьте его в базу — останется вписать
                название и КБЖУ.
              </div>
              <div className="modal-footer-sticky">
                <button
                  className="btn btn-primary w-100"
                  onClick={() => onCreate({ barcode: codeMiss })}
                >
                  <IconPlus size={17} />
                  Добавить продукт
                </button>
              </div>
            </>
          )}
        </>
      );
    }

    if (tab === 'photo') {
      return (
        <>
          {/* Без атрибута capture: система сама предлагает
              «Сделать фото» или «Выбрать из медиатеки». */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pickPhoto(file);
              e.target.value = '';
            }}
          />

          {photo ? (
            <>
              <img className="photo-preview" src={photo} alt="Выбранное блюдо" />

              {recognition ? (
                <div className="card mb-3">
                  <div className="card-body">
                    <div className="d-flex align-items-center gap-2 mb-2">
                      <IconSparkles size={17} />
                      <b>{recognition.name}</b>
                      <span className="badge badge-ai">
                        уверенность {Math.round(recognition.confidence * 100)}%
                      </span>
                    </div>
                    <p className="hint mb-3">
                      {num(recognition.grams)} г · {num(recognition.nutrition.kcal)} ккал на порцию · Б{' '}
                      {num(recognition.nutrition.protein, 1)} · Ж {num(recognition.nutrition.fat, 1)} · У{' '}
                      {num(recognition.nutrition.carbs, 1)}
                    </p>
                    <button className="btn btn-primary w-100" onClick={() => void useRecognition()}>
                      <IconCheck />
                      Добавить в «{mealName}»
                    </button>
                    <button
                      className="btn btn-outline-secondary w-100 mt-2"
                      onClick={() => setRecognition(null)}
                    >
                      Распознать заново
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn btn-primary w-100"
                  onClick={() => void recognizePhoto()}
                  disabled={recognizing || !aiEnabled}
                >
                  {recognizing ? (
                    <>
                      <span className="spinner" />
                      Распознаём…
                    </>
                  ) : (
                    <>
                      <IconSparkles size={17} />
                      Распознать блюдо
                    </>
                  )}
                </button>
              )}

              <button
                className="btn btn-outline-secondary w-100 mt-2"
                onClick={() => fileRef.current?.click()}
              >
                <IconImage size={16} />
                Другое фото
              </button>
            </>
          ) : (
            <button className="dropzone" onClick={() => fileRef.current?.click()}>
              <span className="dropzone__icon">
                <IconCamera size={22} />
              </span>
              <b>Сфотографировать</b>
              <span className="hint">Система предложит камеру или медиатеку</span>
            </button>
          )}

          {aiError && <div className="alert alert-danger mt-3 mb-0">{aiError}</div>}
          {!aiEnabled && (
            <p className="hint mt-3 mb-0">
              Распознавание не настроено на сервере. Добавьте ключ <code>OPENAI_API_KEY</code> или
              заполните продукт вручную.
            </p>
          )}
        </>
      );
    }

    if (tab === 'text') {
      const hasNote = note.trim().length > 0;
      return (
        <>
          <div className="photo-note">
            <label className="form-label" htmlFor="product-note">
              Описание блюда
            </label>
            <textarea
              id="product-note"
              className="form-control"
              rows={4}
              maxLength={NOTE_MAX_LENGTH}
              placeholder="Например: гречка с куриной грудкой и овощами, около 300 грамм"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              autoFocus
            />
            <div
              className={`photo-note__counter${
                note.length >= NOTE_MAX_LENGTH - 50 ? ' is-warning' : ''
              }`}
            >
              {note.length} / {NOTE_MAX_LENGTH}
            </div>
          </div>

          {recognition ? (
            <div className="card mt-3 mb-3">
              <div className="card-body">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <IconSparkles size={17} />
                  <b>{recognition.name}</b>
                  <span className="badge badge-ai">
                    уверенность {Math.round(recognition.confidence * 100)}%
                  </span>
                </div>
                <p className="hint mb-3">
                  {num(recognition.grams)} г · {num(recognition.nutrition.kcal)} ккал на порцию · Б{' '}
                  {num(recognition.nutrition.protein, 1)} · Ж {num(recognition.nutrition.fat, 1)} · У{' '}
                  {num(recognition.nutrition.carbs, 1)}
                </p>
                <button className="btn btn-primary w-100" onClick={() => void useRecognition()}>
                  <IconCheck />
                  Добавить в «{mealName}»
                </button>
                <button
                  className="btn btn-outline-secondary w-100 mt-2"
                  onClick={() => setRecognition(null)}
                >
                  Распознать заново
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-primary w-100 mt-3"
              onClick={() => void recognizeText()}
              disabled={recognizing || !aiEnabled || !hasNote}
            >
              {recognizing ? (
                <>
                  <span className="spinner" />
                  Распознаём…
                </>
              ) : (
                <>
                  <IconSparkles size={17} />
                  Распознать по описанию
                </>
              )}
            </button>
          )}

          {aiError && <div className="alert alert-danger mt-3 mb-0">{aiError}</div>}
          {!aiEnabled && (
            <p className="hint mt-3 mb-0">
              Распознавание не настроено на сервере. Добавьте ключ <code>OPENAI_API_KEY</code> или
              заполните продукт вручную.
            </p>
          )}
        </>
      );
    }

    return (
      <>
        <div className="search-field">
          <IconSearch />
          <input
            className="form-control"
            placeholder="Название продукта"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="list-head">
          {query.trim() ? 'Результаты' : 'Часто используете'}
          {loading && ' · обновляем…'}
        </div>

        {results.length === 0 && !loading ? (
          <div className="empty">
            {query.trim() ? 'Ничего не найдено' : 'Пока нет продуктов'}
            <br />
            <span className="hint">Создайте свой продукт — он сохранится навсегда</span>
          </div>
        ) : (
          <div>
            {results.map((p) => (
              <button key={p.id} className="product" onClick={() => onPick(p)}>
                <span className="product__body">
                  <span className="product__name">
                    {p.name}
                    {p.source === 'ai' && <span className="badge badge-ai">ИИ</span>}
                  </span>
                  <span className="product__meta">
                    {num(p.kcal)} ккал · Б {num(p.protein, 1)} · Ж {num(p.fat, 1)} · У {num(p.carbs, 1)} на
                    100 г
                  </span>
                </span>
                <span
                  className="product__edit"
                  role="button"
                  tabIndex={0}
                  aria-label="Редактировать продукт"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(p);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      e.preventDefault();
                      onEdit(p);
                    }
                  }}
                >
                  <IconPencil />
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="modal-footer-sticky">
          <button
            className="btn btn-soft w-100"
            onClick={() => onCreate({ name: query.trim() })}
          >
            <IconPlus size={17} />
            Создать продукт
          </button>
        </div>
      </>
    );
  };

  return (
    <>
      <div className="segmented">
        <Tabs tab={tab} onTab={setTab} />
      </div>
      {body()}
    </>
  );
}

function Tabs({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const items: [Tab, string, ReactNode][] = [
    ['search', 'Поиск', <IconSearch key="s" size={15} />],
    ['barcode', 'Штрихкод', <IconBarcode key="b" size={15} />],
    ['photo', 'Фото', <IconCamera key="p" size={15} />],
    ['text', 'Описание', <IconSparkles key="t" size={15} />],
  ];
  return (
    <>
      {items.map(([key, label, icon]) => (
        <button
          key={key}
          className={`nav-link${tab === key ? ' active' : ''}`}
          aria-selected={tab === key}
          role="tab"
          onClick={() => onTab(key)}
        >
          {icon}
          {label}
        </button>
      ))}
    </>
  );
}

type BarcodePaneProps = {
  code: string;
  busy: boolean;
  onCode: (v: string) => void;
  onDetect: (v: string) => void;
  onSubmit: () => void;
};

function BarcodePane({ code, busy, onCode, onDetect, onSubmit }: BarcodePaneProps) {
  const [scanning, setScanning] = useState(true);

  // Камера сворачивается сразу после скана: так сразу видно,
  // нашёлся продукт или нет, и не нужно гасить камеру вручную.
  const handleDetect = (value: string) => {
    setScanning(false);
    onDetect(value);
  };

  return (
    <>
      {scanning ? (
        <>
          <BarcodeLive onDetected={handleDetect} />
          <button
            className="btn btn-outline-secondary w-100 mb-3"
            onClick={() => setScanning(false)}
          >
            Выключить камеру
          </button>
        </>
      ) : (
        <button
          className="btn btn-outline-secondary w-100 mb-3"
          onClick={() => setScanning(true)}
        >
          <IconCamera size={17} />
          Включить камеру
        </button>
      )}
      <input
        className="form-control mb-3"
        inputMode="numeric"
        placeholder="Или введите цифры штрихкода"
        value={code}
        onChange={(e) => onCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
        }}
      />
      <button className="btn btn-primary w-100" onClick={onSubmit} disabled={busy}>
        {busy ? (
          <>
            <span className="spinner" />
            Ищем…
          </>
        ) : (
          'Найти продукт'
        )}
      </button>
    </>
  );
}

/** Обёртка над сканером: держит камеру включённой, пока вкладка активна. */
function BarcodeLive({ onDetected }: { onDetected: (code: string) => void }) {
  return (
    <Suspense
      fallback={
        <div className="scanner">
          <div className="scanner__placeholder">Запускаем камеру…</div>
        </div>
      }
    >
      <BarcodeScanner onDetected={onDetected} />
    </Suspense>
  );
}
