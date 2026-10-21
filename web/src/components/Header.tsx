import { formatDaySubtitle, formatDayTitle } from '../lib/date';
import { IconChevronLeft, IconChevronRight, IconLeaf, IconMoon, IconSettings, IconSun } from './Icons';

type Props = {
  date: string;
  theme: 'auto' | 'light' | 'dark';
  onPrev: () => void;
  onNext: () => void;
  onOpenCalendar: () => void;
  onTheme: () => void;
  onSettings: () => void;
};

export function Header({ date, theme, onPrev, onNext, onOpenCalendar, onTheme, onSettings }: Props) {
  return (
    <header className="topbar">
      <div className="container-xxl">
        <div className="topbar__grid">
          <div className="topbar__side">
            <span className="brand">
              <span className="brand__mark">
                <IconLeaf size={19} />
              </span>
              <span className="brand__text">EasyFood</span>
            </span>
          </div>

          <div className="datenav">
            <button className="icon-btn" onClick={onPrev} aria-label="Предыдущий день">
              <IconChevronLeft size={18} />
            </button>
            <button
              className="datenav__label"
              onClick={onOpenCalendar}
              title="Открыть календарь"
            >
              <span className="datenav__date">
                {formatDayTitle(date)}
                <small>{formatDaySubtitle(date)}</small>
              </span>
            </button>
            <button className="icon-btn" onClick={onNext} aria-label="Следующий день">
              <IconChevronRight size={18} />
            </button>
          </div>

          <div className="topbar__side topbar__side--end">
            <button
              className="icon-btn"
              onClick={onTheme}
              aria-label="Переключить тему"
              title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
            <button className="icon-btn" onClick={onSettings} aria-label="Настройки">
              <IconSettings />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
