# Деплой EasyFood на сервер

Параметры из примера:

| Параметр | Значение |
|----------|----------|
| Домен | `food.fastclass.online` |
| IP сервера | `194.87.52.231` |
| Порт приложения на хосте | `127.0.0.1:8080` |
| Репозиторий | `https://github.com/ArseniyKvasov/EasyFood.git` |

Схема: `nginx` (443) → `easyfood-app` (127.0.0.1:8080) → `easyfood-db` (внутренняя сеть Docker).

---

## 1. Подготовка сервера

```bash
ssh root@194.87.52.231

apt update && apt upgrade -y
apt install -y git docker.io docker-compose-plugin curl

# Docker Compose v2 как плагин
apt install -y docker-compose-plugin

# автозапуск демона
systemctl enable --now docker
```

Проверка:

```bash
docker --version && docker compose version
```

---

## 2. DNS

В панели регистратора (или у DNS-провайдера) создайте A-запись:

```
food.fastclass.online.  A  194.87.52.231
```

Проверка (подождите несколько минут на распространение):

```bash
dig +short food.fastclass.online
# должно вернуть 194.87.52.231
```

---

## 3. Клонирование и настройка

```bash
cd /opt
git clone https://github.com/ArseniyKvasov/EasyFood.git
cd EasyFood

cp .env.example .env
```

Отредактируйте `.env`:

```bash
nano .env
```

```ini
# Порт, который приложение занимает на хосте (nginx будет ходить на него)
APP_PORT=8080
APP_BIND=127.0.0.1

# Доступ к базе — задайте СВОЙ пароль
POSTGRES_USER=easyfood
POSTGRES_PASSWORD=CHANGE_ME_strong_password
POSTGRES_DB=easyfood

# CORS не нужен, если фронтенд и API отдаёт один и тот же nginx
CORS_ORIGIN=

# Поиск по штрихкодам и названиям через Open Food Facts
OPEN_FOOD_FACTS_ENABLED=true

# Распознавание блюд по фото (необязательно)
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
OPENAI_REASONING_EFFORT=
OPENAI_TEMPERATURE=0.2
OPENAI_MAX_TOKENS=
OPENAI_RESPONSE_FORMAT=json_object
```

### OpenRouter + Claude Haiku 5.5

Для reasoning-моделей OpenRouter (например, Claude Haiku 5.5) нужны три
дополнительных значения:

```bash
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=anthropic/claude-haiku-5.5
OPENAI_REASONING_EFFORT=medium
OPENAI_TEMPERATURE=            # пусто: Haiku 5.5 принимает только temperature=1
OPENAI_RESPONSE_FORMAT=json_schema
```

`OPENAI_REASONING_EFFORT` уходит в OpenRouter как `reasoning.effort`
(`low`/`minimal`/`medium`/`high`/`xhigh`/`max`/`none`). Пустое значение —
параметр не отправляется, и модель думает на своём дефолте (у Haiku 5.5 это
`medium`).

> Если доступ к репозиторию закрыт, используйте SSH-ключ:
> `git clone git@github.com:ArseniyKvasov/EasyFood.git`

---

## 4. Запуск

```bash
docker compose up -d --build
docker compose ps
```

Приложение поднимется на `127.0.0.1:8080`. Проверка:

```bash
curl -s http://127.0.0.1:8080/api/health
# {"ok":true,"version":"1.0.0"}
```

---

## 5. nginx (сначала только HTTP)

На этом шаге ставим конфиг **без HTTPS** — полный конфиг ссылается на сертификат
Let's Encrypt, которого ещё нет, и nginx не сможет запуститься.

```bash
apt install -y nginx
mkdir -p /var/www/certbot
cp deploy/nginx/food.fastclass.online.http.conf /etc/nginx/sites-available/food.fastclass.online
ln -sf /etc/nginx/sites-available/food.fastclass.online /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Проверка, что nginx работает и проксирует приложение:

```bash
curl -I http://food.fastclass.online
```

---

## 6. Сертификат Let's Encrypt

Подставьте **свой** почтовый ящик вместо `admin@fastclass.online` — иначе Let's Encrypt
не сможет прислать уведомление об истечении сертификата.

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d food.fastclass.online --agree-tos -m admin@fastclass.online --redirect
systemctl enable --now certbot.timer
```

---

## 7. Полный конфиг nginx (HTTP + HTTPS)

Теперь сертификат существует — включаем HTTPS:

```bash
cd /opt/EasyFood
cp deploy/nginx/food.fastclass.online.conf /etc/nginx/sites-available/food.fastclass.online
nginx -t && systemctl reload nginx
```

> **Если публичный 443 у вас обслуживает stream-прокси с маршрутизацией по SNI**
> (проверьте: `nginx -T | grep ssl_preread`), обычный конфиг не сработает — TLS
> завершает тот backend, куда stream отправит соединение по SNI, и домен получит
> чужой сертификат. Тогда используйте вариант для SNI-прокси:
>
> ```bash
> cd /opt/EasyFood
> # 1) в stream-конфиг (/etc/nginx/stream-xray.conf) добавить в map строку
> #    food.fastclass.online 127.0.0.1:8447;
> #    и отдельный server (фрагмент — deploy/nginx/stream-food.fastclass.online.conf):
> #      server {
> #          listen 127.0.0.1:8447;
> #          proxy_pass 127.0.0.1:8448;
> #          proxy_protocol on;
> #      }
>
> # 2) конфиг сайта на локальный порт
> cp deploy/nginx/food.fastclass.online.sni.conf /etc/nginx/sites-available/food.fastclass.online
> nginx -t && systemctl reload nginx
> ```
>
> Проверка, что SNI-маршрут ведёт куда надо:
>
> ```bash
> echo | openssl s_client -connect 127.0.0.1:443 -servername food.fastclass.online 2>/dev/null \
>   | openssl x509 -noout -subject
> # должно быть: subject= CN = food.fastclass.online
> ```
```

Полный конфиг (`deploy/nginx/food.fastclass.online.conf`) делает две вещи:

- на `:80` — ACME-challenge для выпуска сертификата и редирект на HTTPS;
- на `:443` — основной прокси с длинным таймаутом (нужно для распознавания по фото).

Автопродление:

```bash
certbot renew --dry-run
systemctl list-timers | grep certbot
```

Проверка:

```bash
curl -I https://food.fastclass.online
```

> **Если `nginx -t` ругается на `unknown directive "http2"`** — версия nginx старше 1.25.1.
> Конфиг в репозитории совместим со старыми версиями (`listen 443 ssl http2;`),
> достаточно перезалить его:
> `cp /opt/EasyFood/deploy/nginx/food.fastclass.online.conf /etc/nginx/sites-available/food.fastclass.online && nginx -t && systemctl reload nginx`

---

## 8. Firewall

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

Postgres наружу не открывается — он живёт во внутренней сети Docker.

---

## 9. Обновление проекта

```bash
cd /opt/EasyFood
git pull
docker compose up -d --build
docker image prune -f
```

Миграции применяются автоматически при старте контейнера (`backend/src/migrations.ts`).

---

## 10. Бэкапы

```bash
# Дамп базы
docker compose exec -T db pg_dump -U easyfood easyfood | gzip > backup-$(date +%F).sql.gz

# Восстановление
gunzip -c backup-2026-10-21.sql.gz | docker compose exec -T db psql -U easyfood easyfood
```

Автобэкап по cron (`crontab -e`):

```cron
0 3 * * cd /opt/EasyFood && docker compose exec -T db pg_dump -U easyfood easyfood | gzip > /opt/backups/easyfood-$(date +\%F).sql.gz
```

---

## 11. Обслуживание

```bash
docker compose logs -f app       # логи приложения
docker compose logs -f db        # логи БД
docker compose restart app       # перезапуск
docker compose down && docker compose up -d   # пересоздать
docker system df                 # сколько места заняли образы
```

Миграции откатываются вручную: снять последнюю запись в таблице `_migrations`
и выполнить нужный SQL вручную.

---

## Частые проблемы

**`port is already allocated`** — порт занят. Поменяйте `APP_PORT` в `.env` и перезапустите.

**Пустая страница, ошибки в консоли** — проверьте, что фронтенд собрался:
`docker compose logs app | grep -i web`. Файлы лежат в `/app/web/dist`.

**Камера не работает** — `getUserMedia` требует защищённого контекста (HTTPS) либо
`localhost`. По IP-адресу камера работать не будет — нужен домен с сертификатом.

**Не находится продукт по штрихкоду** — проверьте, что сервер ходит в интернет:
`docker compose exec app wget -qO- https://world.openfoodfacts.org/api/v2/product/4600000000001.json | head -c 100`.
