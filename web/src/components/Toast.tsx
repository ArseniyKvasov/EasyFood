import { useEffect, useState } from 'react';

export type ToastItem = {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
};

type Props = {
  items: ToastItem[];
  onDismiss: (id: number) => void;
};

const LIFETIME = 4200;

export function ToastHost({ items, onDismiss }: Props) {
  const [leaving, setLeaving] = useState<number | null>(null);

  useEffect(() => {
    if (!items.length) return;
    const last = items[items.length - 1];
    const t = window.setTimeout(() => {
      setLeaving(last.id);
      window.setTimeout(() => onDismiss(last.id), 180);
    }, LIFETIME);
    return () => window.clearTimeout(t);
  }, [items, onDismiss]);

  if (!items.length) return null;

  return (
    <div className="toast-host" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast${leaving === t.id ? ' toast--leaving' : ''}`}>
          <span className="toast__text">{t.text}</span>
          {t.action && (
            <button
              className="toast__action"
              onClick={() => {
                t.action?.run();
                onDismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
