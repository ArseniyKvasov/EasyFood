import { useState } from 'react';
import { BrowserIcon, type BrowserId } from './BrowserIcons';
import { IconAndroid, IconApple, IconCheck } from './Icons';

export type Platform = 'ios' | 'android';

type Guide = {
  id: BrowserId;
  name: string;
  steps: string[];
};

/** Инструкции по установке: у каждой системы свой набор браузеров. */
const GUIDES: Record<Platform, Guide[]> = {
  ios: [
    {
      id: 'safari',
      name: 'Safari',
      steps: [
        'Нажмите три точки внизу справа.',
        'Выберите «Поделиться».',
        'Нажмите «Показать больше».',
        'Выберите «На экран "Домой"».',
        'Нажмите «Добавить».',
      ],
    },
    {
      id: 'chrome',
      name: 'Chrome',
      steps: [
        'Нажмите «Поделиться» справа от адресной строки.',
        'Нажмите «Показать больше», если этот пункт отображается.',
        'Выберите «На экран "Домой"».',
        'Нажмите «Добавить».',
      ],
    },
    {
      id: 'yandex',
      name: 'Яндекс',
      steps: [
        'Нажмите значок меню внизу справа.',
        'Выберите «Добавить ярлык на телефон».',
        'Нажмите «Добавить на экран "Домой"».',
        'Нажмите «Добавить».',
      ],
    },
    {
      id: 'firefox',
      name: 'Firefox',
      steps: [
        'Нажмите значок «Поделиться» в адресной строке.',
        'Выберите «На экран "Домой"».',
        'Нажмите «Добавить».',
      ],
    },
    {
      id: 'other',
      name: 'Другие',
      steps: [
        'Откройте меню браузера.',
        'Найдите «Добавить на главный экран» или «Добавить ярлык».',
        'Подтвердите добавление.',
      ],
    },
  ],
  android: [
    {
      id: 'chrome',
      name: 'Chrome',
      steps: [
        'Нажмите три точки справа от адресной строки.',
        'Выберите «Добавить на главный экран».',
        'Нажмите «Установить» или «Добавить» - в зависимости от предложенного варианта.',
      ],
    },
    {
      id: 'yandex',
      name: 'Яндекс',
      steps: [
        'Нажмите три точки внизу справа.',
        'Выберите «Добавить ярлык на телефон».',
        'Нажмите «Добавить».',
      ],
    },
    {
      id: 'firefox',
      name: 'Firefox',
      steps: [
        'Нажмите три точки в меню браузера.',
        'Выберите «Добавить на главный экран».',
        'Нажмите «Добавить».',
        'Ещё раз нажмите «Добавить», если появится подтверждение.',
      ],
    },
    {
      id: 'opera',
      name: 'Opera',
      steps: [
        'Откройте меню браузера.',
        'Найдите пункт «Добавить на главный экран».',
        'Подтвердите добавление, если появится запрос.',
      ],
    },
    {
      id: 'other',
      name: 'Другие',
      steps: [
        'Откройте меню браузера.',
        'Найдите «Добавить на главный экран» или «Добавить ярлык».',
        'Подтвердите добавление.',
      ],
    },
  ],
};

/** Android видно по UA, всё остальное считаем iPhone: с него чаще всего заходят. */
function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'ios';
  return /android/i.test(navigator.userAgent) ? 'android' : 'ios';
}

/** Подсказываем вкладку с браузером, в котором открыт сайт. */
function detectBrowser(platform: Platform): BrowserId {
  if (typeof navigator === 'undefined') return GUIDES[platform][0].id;
  const ua = navigator.userAgent;
  if (/yabrowser|yandex/i.test(ua)) return 'yandex';
  if (/opr\/|opera/i.test(ua)) return 'opera';
  if (/firefox|fxios/i.test(ua)) return 'firefox';
  if (/crios|chrome|chromium/i.test(ua)) return 'chrome';
  if (platform === 'ios' && /safari/i.test(ua)) return 'safari';
  return GUIDES[platform][0].id;
}

/** Выделяет «названия кнопок» в шагах: так инструкция читается с одного взгляда. */
function StepText({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('«') ? (
          <b key={i} className="step__ui">
            {part}
          </b>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function InstallGuide() {
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  const [browser, setBrowser] = useState<BrowserId>(() => detectBrowser(platform));

  const guides = GUIDES[platform];
  const guide = guides.find((g) => g.id === browser) ?? guides[0];

  /** Наборы браузеров у систем разные: при смене берём первый доступный. */
  const choosePlatform = (next: Platform) => {
    setPlatform(next);
    if (!GUIDES[next].some((g) => g.id === browser)) setBrowser(GUIDES[next][0].id);
  };

  return (
    <div className="install">
      <div className="segmented segmented--lg install__platforms" role="tablist" aria-label="Система">
        <button
          type="button"
          role="tab"
          aria-selected={platform === 'ios'}
          className={`nav-link${platform === 'ios' ? ' active' : ''}`}
          onClick={() => choosePlatform('ios')}
        >
          <IconApple size={17} />
          iPhone
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={platform === 'android'}
          className={`nav-link${platform === 'android' ? ' active' : ''}`}
          onClick={() => choosePlatform('android')}
        >
          <IconAndroid size={17} />
          Android
        </button>
      </div>

      <div className="segmented install__browsers" role="tablist" aria-label="Браузер">
        {guides.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={g.id === guide.id}
            className={`nav-link${g.id === guide.id ? ' active' : ''}`}
            onClick={() => setBrowser(g.id)}
          >
            <BrowserIcon id={g.id} size={18} />
            {g.name}
          </button>
        ))}
      </div>

      <ol className="steps">
        {guide.steps.map((step, i) => (
          <li className="step" key={`${guide.id}-${i}`}>
            <span className="step__num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="step__text">
              <StepText text={step} />
            </span>
          </li>
        ))}
      </ol>

      <p className="install__tip">
        <IconCheck size={17} />
        <span>Готово: иконка появится среди приложений на главном экране.</span>
      </p>
    </div>
  );
}
