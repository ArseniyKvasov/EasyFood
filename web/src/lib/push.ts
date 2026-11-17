import { api } from '../api';

/** Ключ VAPID приходит в base64url — PushManager ждёт Uint8Array. */
const urlBase64ToUint8Array = (base64: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
};

const supported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/**
 * Регистрирует service worker и, если разрешение ещё не спрашивали,
 * показывает запрос при каждом открытии страницы.
 */
export async function initPush(): Promise<void> {
  if (!supported()) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  } catch {
    /* браузер не дал зарегистрировать SW или спросить разрешение */
  }
}

/** Подписывает текущий браузер на напоминания (нужна сессия). */
export async function syncPushSubscription(): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  try {
    const status = await api.pushStatus();
    if (!status.enabled) return;

    const { key } = await api.pushPublicKey();
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
    }
    await api.pushSubscribe(subscription.toJSON());
  } catch {
    /* напоминания — необязательная функция: молча пропускаем */
  }
}
