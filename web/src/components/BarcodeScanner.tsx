import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

type Props = {
  onDetected: (code: string) => void;
};

export function BarcodeScanner({ onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Наведите камеру на штрихкод');
  const done = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let stopped = false;
    let controls: { stop: () => void } | undefined;
    const reader = new BrowserMultiFormatReader();

    reader
      .decodeFromVideoDevice(undefined, video, (result) => {
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
        setStatus('Нет доступа к камере. Введите штрихкод вручную ниже.');
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
