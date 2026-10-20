# Конфиги nginx

## Какой файл какой

| Файл | Когда использовать |
|------|--------------------|
| `food.fastclass.online.http.conf` | Первый шаг: только HTTP (ACME-challenge + проксирование). Нужен, чтобы выпустить сертификат — полный конфиг на этом шаге падает с «cannot load certificate». |
| `food.fastclass.online.conf` | Обычный сервер: сайт сам слушает 80 и 443 и завершает TLS. |
| `food.fastclass.online.sni.conf` | Сервер, где публичный 443 занят stream-прокси с маршрутизацией по SNI. Сайт слушает только локальный порт 8448, TLS завершается там. |
| `stream-food.fastclass.online.conf` | Фрагмент для stream-конфига: строка в `map $ssl_preread_server_name $backend` и пересылка на локальный порт. |

## Как определить свой случай

```bash
nginx -T | grep -n ssl_preread
```

Пусто — у вас обычный сервер, берите `food.fastclass.online.conf`.
Есть вывод — у вас SNI-прокси, берите `food.fastclass.online.sni.conf` + правку stream-конфига.

## Проверка

```bash
# какой сертификат отдаётся именно для вашего домена
echo | openssl s_client -connect 127.0.0.1:443 -servername food.fastclass.online 2>/dev/null \
  | openssl x509 -noout -subject -issuer
```

В `subject` должен быть ваш домен. Если там сертификат другого сайта —
значит, запрос уходит не туда (см. SNI-вариант выше).

Полная инструкция по деплою — в [`docs/DEPLOY.md`](../../docs/DEPLOY.md).
