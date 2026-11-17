import { useEffect, useState } from 'react';
import { isMobileDevice } from '../lib/device';
import { IconChevronRight, IconPhonePlus } from './Icons';

type Props = {
  onOpen: () => void;
};

/** Уже открыто как приложение - предлагать установку не нужно. */
const isStandalone = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari: сайт, запущенный с домашнего экрана.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
};

/** Баннер внизу главной: открывает инструкцию «как добавить на главный экран». */
export function InstallBanner({ onOpen }: Props) {
  const [installed, setInstalled] = useState(isStandalone);
  const [mobile] = useState(isMobileDevice);

  useEffect(() => {
    const query = window.matchMedia?.('(display-mode: standalone)');
    if (!query) return;
    const update = () => setInstalled(isStandalone());
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // Только телефон и только пока приложение не установлено.
  if (!mobile || installed) return null;

  return (
    <button type="button" className="install-banner" onClick={onOpen}>
      <span className="install-banner__icon">
        <IconPhonePlus size={20} />
      </span>
      <span className="install-banner__title">Добавить приложение на главный экран</span>
      <span className="install-banner__arrow">
        <IconChevronRight size={18} />
      </span>
    </button>
  );
}
