/* Проверка сессии на главной: авторизованных уводим в приложение.
   Остальным показываем лендинг — экран входа им не нужен. */
(function () {
  'use strict';

  if (location.pathname !== '/' || !window.fetch) return;

  var KEY = 'bb_gate_at';

  // Только что уже уходили в приложение: не зацикливаемся, если оно вернёт обратно.
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) || 0) < 8000) return;
  } catch (e) {}

  fetch('/api/auth/me', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  })
    .then(function (res) {
      if (!res.ok) return; // 401 — обычный гость, остаётся на лендинге
      try { sessionStorage.setItem(KEY, String(Date.now())); } catch (e) {}
      location.replace('/app/');
    })
    .catch(function () {
      /* сервер недоступен — показываем лендинг */
    });
})();
