# Деплой EasyFood на сервер

Параметры из примера:

| Параметр | Значение |
|----------|----------|
| Домен | `food.fastclass.ru` |
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
food.fastclass.ru.  A  194.87.52.231
```

Проверка (подождите несколько минут на распространение):

```bash
dig +short food.fastclass.ru
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

### Nutriapix: каталог продуктов

Основной источник данных о продуктах. Ключ выдаётся на
<https://nutriapix.ru>, в `.env`:

```bash
NUTRIAPIX_API_KEY=...
NUTRIAPIX_BASE_URL=https://nutriapix.ru/api/v1
NUTRIAPIX_MONTHLY_BUDGET=1000        # лимит запросов /food в месяц
NUTRIAPIX_BACKFILL_BUDGET=700         # сколько из них отдаём предзагрузке
NUTRIAPIX_BACKFILL_BATCH=2            # продуктов за один проход
NUTRIAPIX_BACKFILL_INTERVAL_HOURS=2   # как часто запускать предзагрузку
```

Пока ключа нет, поиск работает на своей базе и Open Food Facts.

**Лимиты.** У тестового токена `/food` — 1000 запросов в месяц, остальные
методы без месячного ограничения. Приложение считает расход сам, в таблице
`api_usage`:

| Счётчик | Кто тратит | Лимит |
|---------|-----------|-------|
| `nutriapix.food` | пользователи: доскачиваем КБЖУ выбранного продукта | `MONTHLY_BUDGET - BACKFILL_BUDGET` |
| `nutriapix.food.backfill` | предзагрузка каталога | `BACKFILL_BUDGET` |

Поиск (`/food/search`) и подсказки (`/food/search/hints`) лимита не расходуют
вообще. Частота запросов тоже ограничена: 5 запросов в секунду на обычные
методы и 20 на подсказки.

**Предзагрузка каталога.** Сервис `maintenance` раз в
`NUTRIAPIX_BACKFILL_INTERVAL_HOURS` берёт следующий запрос из очереди
`catalog_backfill`, находит в Nutriapix продукты по этому запросу и
дозакачивает их КБЖУ в нашу базу. Очередь стартует с частых продуктов
(гречка, рис, овсянка, курица, молоко и ещё 25) — по два продукта за проход.

```bash
docker compose logs -f maintenance | grep каталог
```

**Сколько каталог наполнен:**

```bash
docker compose exec -T db psql -U easyfood -d easyfood \
  -c "SELECT count(*) FROM products WHERE user_id IS NULL AND source = 'np';" \
  -c "SELECT provider, used FROM api_usage;"
```

### S3: фото пользователей и бэкапы базы

Если `S3_BUCKET`, `S3_ACCESS_KEY_ID` и `S3_SECRET_ACCESS_KEY` заданы, приложение
работает иначе:

- фото из браузера уходит **прямо в бакет** по подписанной ссылке — сервер
  приложения байты картинки не видит, а ИИ забирает её из бакета по своей
  подписанной ссылке;
- сервис `maintenance` складывает в бакет дампы базы (`pg_dump` в gzip) и
  удаляет бэкапы старше `S3_BACKUP_KEEP_DAYS` дней.

Без этих переменных всё работает как раньше: фото идёт через сервер,
бэкапы не делаются.

```bash
S3_BUCKET=easyfood
S3_ENDPOINT_URL=                 # пусто — AWS S3; Yandex Cloud: https://storage.yandexcloud.net
S3_REGION_NAME=ru-central1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=false        # MinIO — true
S3_LOCATION=uploads              # папка с фото пользователей
S3_BACKUP_LOCATION=backups       # папка с дампами базы
S3_QUERYSTRING_EXPIRE=900        # срок жизни подписанной ссылки, секунд
S3_BACKUP_KEEP_DAYS=14           # сколько дней хранить бэкапы
S3_UPLOAD_KEEP_HOURS=24          # сколько часов может жить загруженная картинка
```

**CORS бакета** — без него браузер не сможет положить файл напрямую:

```bash
aws s3api put-bucket-cors --bucket easyfood --cors-configuration file://deploy/s3-cors.json
```

**Жизненный цикл** — фото нужны только на время распознавания, их стоит
удалять:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket easyfood --lifecycle-configuration file://deploy/s3-lifecycle.json
```

### Сколько живут фото в бакете

Картинка удаляется тремя способами — вместе они дают гарантию, что снимок
не пролежит в бакете дольше суток:

1. **Сразу после создания продукта** — приложение удаляет объект, как только
   из фото сделан продукт.
2. **При закрытии шторки** — если пользователь бросил распознавание, фото
   удаляется при закрытии окна.
3. **Чистка по расписанию** — сервис `maintenance` раз в
   `UPLOAD_CLEANUP_INTERVAL_HOURS` удаляет всё, что старше
   `S3_UPLOAD_KEEP_HOURS`. Порог считается с запасом на интервал чистки,
   поэтому картинка не переживает сутки.

Плюс правило жизненного цикла бакета (`deploy/s3-lifecycle.json`) — последний
страховочный круг на стороне S3.

**Проверка:**

```bash
docker compose exec app node -e "import('./backend/dist/config.js').then(m=>console.log(m.s3Enabled()))"
# true
```

`OPENAI_REASONING_EFFORT` уходит в OpenRouter как `reasoning.effort`
(`low`/`minimal`/`medium`/`high`/`xhigh`/`max`/`none`). Пустое значение —
параметр не отправляется, и модель думает на своём дефолте (у Haiku 5.5 это
`medium`).

### RouterAI (оплата в рублях)

RouterAI — OpenAI-совместимый шлюз с тем же каталогом моделей. Меняются
только две строки:

```bash
OPENAI_BASE_URL=https://routerai.ru/api/v1
OPENAI_MODEL=anthropic/claude-haiku-5.5
```

Ключ создаётся в https://routerai.ru/settings/keys, авторизация та же —
`Authorization: Bearer <ключ>`. Модель обслуживают пять провайдеров (Anthropic,
Azure, Google Vertex, AWS Bedrock, Claude Platform on AWS); `reasoning`
поддерживают все, а `structured_outputs` (`json_schema`) — не все, поэтому при
ошибках разбора JSON переключите `OPENAI_RESPONSE_FORMAT` на `json_object`.

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
cp deploy/nginx/food.fastclass.ru.http.conf /etc/nginx/sites-available/food.fastclass.ru
ln -sf /etc/nginx/sites-available/food.fastclass.ru /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Проверка, что nginx работает и проксирует приложение:

```bash
curl -I http://food.fastclass.ru
```

---

## 6. Сертификат Let's Encrypt

Подставьте **свой** почтовый ящик вместо `admin@fastclass.online` — иначе Let's Encrypt
не сможет прислать уведомление об истечении сертификата.

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d food.fastclass.ru --agree-tos -m admin@fastclass.online --redirect
systemctl enable --now certbot.timer
```

---

## 7. Полный конфиг nginx (HTTP + HTTPS)

Теперь сертификат существует — включаем HTTPS:

```bash
cd /opt/EasyFood
cp deploy/nginx/food.fastclass.ru.conf /etc/nginx/sites-available/food.fastclass.ru
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
> #    food.fastclass.ru 127.0.0.1:8447;
> #    и отдельный server (фрагмент — deploy/nginx/stream-food.fastclass.ru.conf):
> #      server {
> #          listen 127.0.0.1:8447;
> #          proxy_pass 127.0.0.1:8448;
> #          proxy_protocol on;
> #      }
>
> # 2) конфиг сайта на локальный порт
> cp deploy/nginx/food.fastclass.ru.sni.conf /etc/nginx/sites-available/food.fastclass.ru
> nginx -t && systemctl reload nginx
> ```
>
> Проверка, что SNI-маршрут ведёт куда надо:
>
> ```bash
> echo | openssl s_client -connect 127.0.0.1:443 -servername food.fastclass.ru 2>/dev/null \
>   | openssl x509 -noout -subject
> # должно быть: subject= CN = food.fastclass.ru
> ```
```

Полный конфиг (`deploy/nginx/food.fastclass.ru.conf`) делает две вещи:

- на `:80` — ACME-challenge для выпуска сертификата и редирект на HTTPS;
- на `:443` — основной прокси с длинным таймаутом (нужно для распознавания по фото).

Автопродление:

```bash
certbot renew --dry-run
systemctl list-timers | grep certbot
```

Проверка:

```bash
curl -I https://food.fastclass.ru
```

> **Если `nginx -t` ругается на `unknown directive "http2"`** — версия nginx старше 1.25.1.
> Конфиг в репозитории совместим со старыми версиями (`listen 443 ssl http2;`),
> достаточно перезалить его:
> `cp /opt/EasyFood/deploy/nginx/food.fastclass.ru.conf /etc/nginx/sites-available/food.fastclass.ru && nginx -t && systemctl reload nginx`

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

Сервис `maintenance` (бэкапы в S3 и чистка истории) обновляется тем же образом —
он собран из того же образа.

---

## 10. Бэкапы

### Автоматически в S3

Сервис `maintenance` делает дамп базы и складывает его в бакет:

```bash
docker compose ps maintenance            # статус
docker compose logs -f maintenance       # логи
```

Расписание — переменными в `.env`:

```bash
BACKUP_INTERVAL_HOURS=24                 # как часто делать дамп
S3_BACKUP_KEEP_DAYS=14                   # сколько дней хранить
```

Разовый бэкап вручную:

```bash
docker compose exec maintenance node backend/dist/scripts/maintenance.js --once
```

### Ручной дамп без S3

```bash
# Дамп базы
docker compose exec -T db pg_dump -U easyfood easyfood | gzip > backup-$(date +%F).sql.gz

# Восстановление
gunzip -c backup-2026-10-21.sql.gz | docker compose exec -T db psql -U easyfood easyfood
```

### Восстановление из S3

```bash
# Скачать последний дамп
aws s3 cp s3://easyfood/backups/easyfood-2026-10-21T03-00-00.000Z.sql.gz /tmp/backup.sql.gz

# Залить в базу
gunzip -c /tmp/backup.sql.gz | docker compose exec -T db psql -U easyfood easyfood
```

Дамп сделан с ключами `--clean --if-exists`, поэтому restore пересоздаёт
таблицы. Перед восстановлением остановите приложение, чтобы оно не писало
в базу, пока идёт заливка:

```bash
docker compose stop app
```

---

## 10.1. Хранение истории

Дневник хранится `HISTORY_RETENTION_DAYS` дней (по умолчанию 60). Записи
старше этого срока удаляются сервисом `maintenance` — при старте приложения
и каждые `RETENTION_INTERVAL_HOURS` часов.

```bash
HISTORY_RETENTION_DAYS=60
RETENTION_INTERVAL_HOURS=6
```

Сколько записей осталось:

```bash
docker compose exec -T db psql -U easyfood easyfood \
  -c "SELECT count(*), min(day), max(day) FROM entries;"
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
