/** Браузеры, для которых есть инструкция. */
export type BrowserId = 'safari' | 'chrome' | 'yandex' | 'firefox' | 'opera' | 'other';

type Props = {
  id: BrowserId;
  size?: number;
  className?: string;
};

const frame = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
  focusable: 'false' as const,
});

/**
 * Значки браузеров для вкладок с инструкциями.
 * Яндекс и Firefox - официальные логотипы (web/public/icons), остальные
 * нарисованы вручную, чтобы не тянуть иконный пакет из-за шести картинок.
 */
export function BrowserIcon({ id, size = 20, className }: Props) {
  if (id === 'yandex') {
    return (
      <img
        className={className}
        src={`${import.meta.env.BASE_URL}icons/yandex.svg`}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
      />
    );
  }

  if (id === 'firefox') {
    return (
      <img
        className={className}
        src={`${import.meta.env.BASE_URL}icons/firefox.svg`}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
      />
    );
  }

  if (id === 'safari') {
    return (
      <svg {...frame(size)} className={className}>
        <defs>
          <linearGradient id="bb-safari" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3bb2f6" />
            <stop offset="1" stopColor="#0f7bd1" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="11" fill="url(#bb-safari)" />
        <circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="1" />
        <path d="M16.6 7.4 13.5 13.5 7.4 16.6 10.5 10.5Z" fill="#fff" />
        <path d="M16.6 7.4 10.5 10.5 13.5 13.5Z" fill="#f2453d" />
      </svg>
    );
  }

  if (id === 'chrome') {
    return (
      <svg {...frame(size)} className={className}>
        <path d="M12 12 2.47 6.5A11 11 0 0 1 21.53 6.5Z" fill="#ea4335" />
        <path d="M12 12 21.53 6.5A11 11 0 0 1 12 23Z" fill="#fbbc05" />
        <path d="M12 12 12 23A11 11 0 0 1 2.47 6.5Z" fill="#34a853" />
        <circle cx="12" cy="12" r="5.4" fill="#fff" />
        <circle cx="12" cy="12" r="4.2" fill="#4285f4" />
      </svg>
    );
  }

  if (id === 'opera') {
    return (
      <svg {...frame(size)} className={className}>
        <defs>
          <linearGradient id="bb-opera" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff2b45" />
            <stop offset="1" stopColor="#c7002e" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="11" fill="url(#bb-opera)" />
        <ellipse cx="12" cy="12" rx="5.1" ry="7.4" fill="none" stroke="#fff" strokeWidth="2.7" />
      </svg>
    );
  }

  return (
    <svg {...frame(size)} className={className}>
      <circle cx="12" cy="12" r="11" fill="var(--surface-3)" />
      <circle cx="12" cy="12" r="6.4" fill="none" stroke="var(--muted)" strokeWidth="1.5" />
      <path d="M5.7 9.6h12.6M5.7 14.4h12.6" stroke="var(--muted)" strokeWidth="1.5" />
      <path
        d="M12 5.6c2.1 1.9 3.2 4 3.2 6.4S14.1 16.5 12 18.4c-2.1-1.9-3.2-4-3.2-6.4S9.9 7.5 12 5.6Z"
        fill="none"
        stroke="var(--muted)"
        strokeWidth="1.4"
      />
    </svg>
  );
}
