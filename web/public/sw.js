/* BiteBalance: приём push-напоминаний и клик по уведомлению. */
// Приложение живёт на /app/, лендинг на корне: все пути считаем от своей области.
const BASE = new URL(self.registration.scope).pathname;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = { title: 'BiteBalance', body: 'You can now', url: BASE };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    /* не JSON — показываем текст по умолчанию */
  }
  // Сервер может прислать корень — приводим к области приложения.
  if (!payload.url || payload.url === '/') payload.url = BASE;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: BASE + 'favicon.svg',
      badge: BASE + 'favicon.svg',
      data: { url: payload.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const fallback = BASE;
  const url = (event.notification.data && event.notification.data.url) || fallback;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
