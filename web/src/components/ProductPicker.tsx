import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api';
import { fileToDataUrl, fileToImageBlob } from '../lib/image';
import { num } from '../lib/format';
import type { MealId, Product, Recognition } from '../types';
import {
  IconBarcode,
  IconCamera,
  IconCheck,
  IconImage,
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
  /** Идёт ли запрос КБЖУ у внешнего каталога. */
  hydrating?: boolean;
  onPick: (product: Product) => void;
  onCreate: (prefill: { name?: string; barcode?: string }) => void;
};

type CardProps = {
  result: Recognition;
  mealName: string;
  onAdd: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
};

/** Карточка распознанного блюда: состав, добавление и действие «сделать снова». */
function RecognitionCard({
  result,
  mealName,
  onAdd,
  secondaryLabel,
  onSecondary,
}: CardProps) {
  // nutrition приходит в расчёте на 100 г, а показываем итог за порцию.
  const k = result.grams / 100;
  const portion = {
    kcal: result.nutrition.kcal * k,
    protein: result.nutrition.protein * k,
    fat: result.nutrition.fat * k,
    carbs: result.nutrition.carbs * k,
  };

  return (
    <div className="card mt-3 mb-3">
      <div className="card-body">
        <div className="d-flex align-items-center gap-2 mb-2">
          <IconSparkles size={17} className="flex-shrink-0" />
          <b className="text-truncate recognition__name">{result.name}</b>
        </div>
        <p className="hint mb-3">
          {num(result.grams)} г · {num(portion.kcal)} ккал на порцию · Б {num(portion.protein, 1)} · Ж{' '}
          {num(portion.fat, 1)} · У {num(portion.carbs, 1)}
        </p>
        <button className="btn btn-primary w-100" onClick={onAdd}>
          <IconCheck />
          Добавить в «{mealName}»
        </button>
        {secondaryLabel && onSecondary && (
          <button className="btn btn-outline-secondary w-100 mt-2" onClick={onSecondary}>
            {secondaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function ProductPicker({
  meal,
  mealName,
  refreshToken,
  hydrating = false,
  onPick,
  onCreate,
}: Props) {
  const [tab, setTab] = useState<Tab>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [remote, setRemote] = useState<Product[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [code, setCode] = useState('');
  const [codeMiss, setCodeMiss] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);

  // Фото и описание — два независимых режима: результат одного не переносится
  // в другой, у каждого своё состояние.
  const [photoState, setPhotoState] = useState({
    image: null as string | null,
    note: '',
    result: null as Recognition | null,
    /** Ключ загруженной картинки в S3 — её надо удалить, когда она больше не нужна. */
    key: null as string | null,
  });
  const [textState, setTextState] = useState({
    note: '',
    result: null as Recognition | null,
  });
  const [recognizing, setRecognizing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  /** Исходный файл — из него качаем blob для загрузки в S3. */
  const photoFile = useRef<File | null>(null);
  /** Ключ загруженной картинки — чтобы убрать её из бакета, когда она не нужна. */
  const uploadKey = useRef<string | null>(null);
  const requestId = useRef(0);

  /** Убирает картинку из бакета: после использования она больше не нужна. */
  const dropUpload = (key: string | null) => {
    if (!key) return;
    void api.deleteUpload(key).catch(() => undefined);
  };

  // Пользователь закрыл шторку, не сохранив продукт: картинка всё равно
  // не нужна — удаляем. Если он не дошёл до конца, заберёт чистка по суткам.
  useEffect(
    () => () => {
      dropUpload(uploadKey.current);
      uploadKey.current = null;
    },
    [],
  );

  useEffect(() => {
    api
      .aiStatus()
      .then((s) => setAiEnabled(s.enabled))
      .catch(() => setAiEnabled(false));
  }, []);

  // Поиск: своя база (с опечатками) + Nutriapix + Open Food Facts.
  // Если ничего не нашлось — подсказываем похожие названия.
  useEffect(() => {
    const q = query.trim();
    const id = ++requestId.current;
    if (q.length < 2) {
      // Пустой запрос — показываем то, что пользователь добавляет чаще всего.
      setSuggestions([]);
      api
        .getProducts('')
        .then((res) => {
          if (id === requestId.current) setResults(res.products);
        })
        .catch(() => {
          if (id === requestId.current) setResults([]);
        });
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.searchProducts(q);
        if (id !== requestId.current) return;
        setResults(res.products);
        setRemote([]);
        // Свои продукты и Nutriapix уже показаны — ждать Open Food Facts не нужно.
        setLoading(false);
        if (res.products.length === 0) {
          try {
            const hints = await api.productHints(q);
            if (id === requestId.current) setSuggestions(hints.hints);
          } catch {
            if (id === requestId.current) setSuggestions([]);
          }
        } else {
          setSuggestions([]);
        }
        // Open Food Facts отвечает медленно — догружаем отдельно,
        // чтобы результаты из своей базы и Nutriapix были видны сразу.
        if (res.more) {
          try {
            const off = await api.getRemoteProducts(q);
            if (id === requestId.current) setRemote(off.products);
          } catch {
            if (id === requestId.current) setRemote([]);
          }
        }
      } catch {
        if (id === requestId.current) setResults([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query, refreshToken]);

  /** Свои продукты и Nutriapix + позже догруженный Open Food Facts. */
  const allResults = useMemo(() => {
    const seen = new Set(results.map((p) => p.name.toLowerCase()));
    return [...results, ...remote.filter((p) => !seen.has(p.name.toLowerCase()))];
  }, [results, remote]);

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
    try {
      const image = await fileToDataUrl(file);
      photoFile.current = file;
      // Предыдущее фото больше не понадобится — убираем его из бакета.
      dropUpload(uploadKey.current);
      uploadKey.current = null;
      setPhotoState((s) => ({ ...s, image, result: null, key: null }));
    } catch {
      setAiError('Не удалось прочитать файл.');
    }
  };

  /**
   * Кладёт фото прямо в S3: сервер приложения байты картинки не видит.
   * Если хранилище не настроено — возвращаем null, и фото уходит
   * запасным путём через сервер.
   */
  const uploadToS3 = async (file: File): Promise<string | null> => {
    const blob = await fileToImageBlob(file);
    try {
      const { key, uploadUrl, contentType } = await api.presignUpload({
        contentType: 'image/jpeg',
        size: blob.size,
      });
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': contentType },
      });
      if (!res.ok) throw new Error(`UPLOAD_FAILED_${res.status}`);
      return key;
    } catch (err) {
      // S3 не настроен — откатываемся на отправку через сервер.
      if (err instanceof ApiError && err.status === 501) return null;
      throw err;
    }
  };

  const recognizePhoto = async () => {
    const { image, note } = photoState;
    if (!image) return;
    setRecognizing(true);
    setAiError(null);
    try {
      const file = photoFile.current;
      const key = file ? await uploadToS3(file) : null;
      if (key) {
        try {
          const result = await api.recognize({ key, note: note.trim() || undefined });
          uploadKey.current = key;
          setPhotoState((s) => ({ ...s, result, key }));
        } catch (err) {
          // Фото уже в бакете, но распознать не вышло — убираем мусор.
          dropUpload(key);
          throw err;
        }
      } else {
        const result = await api.recognize({ image, note: note.trim() || undefined });
        setPhotoState((s) => ({ ...s, result }));
      }
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : 'Распознавание не удалось.');
    } finally {
      setRecognizing(false);
    }
  };

  const recognizeText = async () => {
    const text = textState.note.trim();
    if (!text) return;
    setRecognizing(true);
    setAiError(null);
    try {
      const result = await api.recognizeByText(text);
      setTextState((s) => ({ ...s, result }));
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : 'Распознавание не удалось.');
    } finally {
      setRecognizing(false);
    }
  };

  const useRecognition = async () => {
    const recognition = tab === 'photo' ? photoState.result : textState.result;
    if (!recognition) return;
    const product = await api.createProduct({
      name: recognition.name,
      // С десятичным знаком — иначе округление до целого «съедает»
      // калории и итог по порции не совпадает с показанным в карточке.
      kcal: Math.round(recognition.nutrition.kcal * 10) / 10,
      protein: Math.round(recognition.nutrition.protein * 10) / 10,
      fat: Math.round(recognition.nutrition.fat * 10) / 10,
      carbs: Math.round(recognition.nutrition.carbs * 10) / 10,
      servingG: recognition.grams,
      source: 'ai',
    });
    // Продукт создан — картинка больше не нужна, убираем её из бакета.
    if (tab === 'photo') {
      dropUpload(uploadKey.current);
      uploadKey.current = null;
      setPhotoState((s) => ({ ...s, key: null }));
    }
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
      const { image, note, result } = photoState;
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

          {image ? (
            <>
              <img className="photo-preview" src={image} alt="Выбранное блюдо" />

              <div className="photo-note">
                <label className="form-label" htmlFor="photo-note">
                  Описание блюда (необязательно)
                </label>
                <textarea
                  id="photo-note"
                  className="form-control"
                  rows={2}
                  maxLength={NOTE_MAX_LENGTH}
                  placeholder="Например: гречка с куриной грудкой и овощами"
                  value={note}
                  onChange={(e) => setPhotoState((s) => ({ ...s, note: e.target.value }))}
                />
                <div
                  className={`photo-note__counter${
                    note.length >= NOTE_MAX_LENGTH - 50 ? ' is-warning' : ''
                  }`}
                >
                  {note.length} / {NOTE_MAX_LENGTH}
                </div>
              </div>

              <button
                className="btn btn-primary w-100 mt-3"
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

              {result && (
                <RecognitionCard
                  result={result}
                  mealName={mealName}
                  onAdd={() => void useRecognition()}
                />
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
      const { note, result } = textState;
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
              onChange={(e) => setTextState((s) => ({ ...s, note: e.target.value }))}
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

          <button
            className="btn btn-primary w-100 mt-3"
            onClick={() => void recognizeText()}
            disabled={recognizing || !aiEnabled || !hasNote}
          >
            {recognizing ? (
              <>
                <span className="spinner" />
                Определяем…
              </>
            ) : (
              <>
                <IconSparkles size={17} />
                Определить КБЖУ
              </>
            )}
          </button>

          {result && (
            <RecognitionCard
              result={result}
              mealName={mealName}
              onAdd={() => void useRecognition()}
              secondaryLabel="Пересчитать"
              onSecondary={() => void recognizeText()}
            />
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
          {hydrating && ' · уточняем КБЖУ…'}
        </div>

        {allResults.length === 0 && !loading ? (
          <div className="empty">
            <div className="empty__text">
              {query.trim() ? 'Ничего не найдено' : 'Пока нет продуктов'}
              {suggestions.length > 0 && (
                <>
                  <span className="hint">Возможно, вы искали:</span>
                  <span className="suggestions">
                    {suggestions.map((h) => (
                      <button key={h} className="chip" onClick={() => setQuery(h)}>
                        {h}
                      </button>
                    ))}
                  </span>
                </>
              )}
            </div>
          </div>
        ) : (
          <div>
            {allResults.map((p) => (
              <button
                key={`${p.source}-${p.id || p.extSlug}`}
                className="product"
                disabled={hydrating}
                onClick={() => onPick(p)}
              >
                <span className="product__body">
                  <span className="product__name">{p.name}</span>
                  <span className="product__meta">
                    {p.pending ? (
                      'КБЖУ уточняются…'
                    ) : (
                      <>
                        {num(p.kcal)} ккал · Б {num(p.protein, 1)} · Ж {num(p.fat, 1)} · У{' '}
                        {num(p.carbs, 1)} на 100 г
                      </>
                    )}
                  </span>
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
