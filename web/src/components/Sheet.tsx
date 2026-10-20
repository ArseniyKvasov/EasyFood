import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconChevronLeft, IconClose } from './Icons';

type Props = {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
  /** Рендерится между заголовком и кнопкой закрытия (например, сегменты). */
  belowTitle?: ReactNode;
};

export function Sheet({ title, onClose, onBack, children, belowTitle }: Props) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    timer.current = window.setTimeout(onClose, 170);
  };

  return (
    <div
      className="overlay"
      data-closing={closing ? 'true' : 'false'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
      role="presentation"
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__head">
          {onBack ? (
            <button className="icon-btn" onClick={onBack} aria-label="Назад">
              <IconChevronLeft />
            </button>
          ) : (
            <span className="sheet__spacer" />
          )}
          <h2 className="sheet__title">{title}</h2>
          <button className="icon-btn" onClick={requestClose} aria-label="Закрыть">
            <IconClose />
          </button>
        </div>
        {belowTitle}
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  );
}
