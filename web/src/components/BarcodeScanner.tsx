import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType } from '@zxing/library';

type Props = {
  onDetected: (code: string) => void;
};

/**
 * Крупные штрихкоды читаются плохо, поэтому просим камеру отдавать
 * максимальное разрешение и включаем TRY_HARDER — он заметно повышает
 * скорость декодирования, особенно при неудачном ракурсе.
 */
const HINTS = new Map<DecodeHintType, unknown>([[DecodeHintType.TRY_HARDER, true]]);

type Camera = {
  /** Соотношение сторон кадра в том виде, в каком его отдаёт браузер. */
  ratio: number;
  /** Кадр вертикальный, но телефон повёрнут — картинку надо повернуть. */
  rotated: boolean;
};

export function BarcodeScanner({ onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Наведите камеру на штрихкод');
  const [camera, setCamera] = useState<Camera | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let stopped = false;
    let controls: { stop: () => void } | undefined;
    const reader = new BrowserMultiFormatReader(HINTS);

    /**
     * Подстраиваем рамку под камеру: у ноутбука кадр широкий, у телефона
     * в портретной ориентации — узкий. Если телефон повёрнут, а поток
     * остался вертикальным, разворачиваем картинку.
     */
    const measure = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;

      const angle = screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0;
      const screenLandscape = Math.abs(angle) === 90;
      const streamPortrait = vh > vw;
      const rotated = streamPortrait && screenLandscape;

      setCamera({
        ratio: rotated ? vh / vw : vw / vh,
        rotated,
      });
    };

    const onOrientation = () => {
      // Переворачиваем телефон — пересчитываем рамку.
      setTimeout(measure, 120);
    };

    video.addEventListener('loadedmetadata', measure);
    video.addEventListener('resize', measure);
    window.addEventListener('orientationchange', onOrientation);
    screen.orientation?.addEventListener('change', onOrientation);
    measure();

    // Задняя камера на телефоне: она ближе к объекту и не требует
    // переворачивать телефон. На ноутбуках ограничение просто игнорируется.
    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        aspectRatio: { ideal: 16 / 9 },
      },
      audio: false,
    };

    reader
      .decodeFromConstraints(constraints, video, (result) => {
        if (result && !done.current) {
          done.current = true;
          setStatus('Штрихкод найден');
          onDetected(result.getText());
        }
      })
      .then((c) => {
        if (stopped) {
          c.stop();
          return;
        }
        controls = c;
      })
      .catch(() => {
        setStatus('Нет доступа к камере. Введите штрихкод вручную.');
      });

    return () => {
      stopped = true;
      video.removeEventListener('loadedmetadata', measure);
      video.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', onOrientation);
      screen.orientation?.removeEventListener('change', onOrientation);
      try {
        controls?.stop();
      } catch {
        /* сканер уже остановлен */
      }
    };
  }, [onDetected]);

  const style = camera
    ? ({
        // соотношение сторон рамки (как её видит пользователь)
        '--cam-ratio': String(camera.ratio),
        // исходное соотношение потока — нужно, чтобы развернуть картинку
        '--cam-stream-ratio': String(camera.rotated ? 1 / camera.ratio : camera.ratio),
      } as CSSProperties)
    : undefined;

  return (
    <div className={`scanner${camera?.rotated ? ' is-rotated' : ''}`} style={style}>
      <video ref={videoRef} playsInline muted />
      <div className="scanner__frame" />
      <div className="scanner__laser" />
      <div className="scanner__status">{status}</div>
    </div>
  );
}
