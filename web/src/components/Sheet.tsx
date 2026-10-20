import type { ReactNode } from 'react';
import { IconChevronLeft, IconClose } from './Icons';

type Props = {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
};

/**
 * Содержимое модального окна. Сама обёртка `.modal` и `.modal-backdrop`
 * рендерится в App — так окно не пересоздаётся при переходах между шагами.
 */
export function Sheet({ title, onClose, onBack, children }: Props) {
  return (
    <>
      <div className="modal-header">
        {onBack ? (
          <button className="icon-btn" onClick={onBack} aria-label="Назад">
            <IconChevronLeft />
          </button>
        ) : (
          <span style={{ width: 40, flex: 'none' }} />
        )}
        <h2 className="modal-title">{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
          <IconClose />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </>
  );
}
