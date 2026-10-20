import { useEffect, useRef, useState } from 'react';
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

export function BarcodeScanner({ onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Наведите камеру на штрихкод');
  const done = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let stopped = false;
    let controls: { stop: () => void } | undefined;
    const reader = new BrowserMultiFormatReader(HINTS);

    // Задняя камера на телефоне: она ближе к объекту и не требует
    // переворачивать телефон. На ноутбуках ограничение просто игнорируется.
    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
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
      try {
        controls?.stop();
      } catch {
        /* сканер уже остановлен */
      }
    };
  }, [onDetected]);

  return (
    <div className="scanner">
      <video ref={videoRef} playsInline muted />
      <div className="scanner__frame" />
      <div className="scanner__laser" />
      <div className="scanner__status">{status}</div>
    </div>
  );
}
