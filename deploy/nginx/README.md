# Конфиги nginx

`food.fastclass.online.conf` — готовый конфиг для домена `food.fastclass.online`:
проксирование на `127.0.0.1:8080`, ACME-challenge для Let's Encrypt,
кеширование статики и заголовки безопасности.

Если меняете домен, поправьте в конфиге `server_name`, путь к сертификату
и IP/порт в `proxy_pass`.

Полная инструкция по деплою — в [`docs/DEPLOY.md`](../../docs/DEPLOY.md).
