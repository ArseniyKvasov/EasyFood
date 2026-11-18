# Деплой BiteBalance на сервер

Параметры из примера:

| Параметр | Значение |
|----------|----------|
| Домен | `food.fastclass.ru` |
| IP сервера | `194.87.52.231` |
| Порт приложения на хосте | `127.0.0.1:8080` |
| Репозиторий | `https://github.com/ArseniyKvasov/EasyFood.git` (пока старое имя) |

Схема: `nginx` (443) → `bitebalance-app` (127.0.0.1:8080) → `bitebalance-db` (внутренняя сеть Docker).

> Проект переименован в BiteBalance. Репозиторий и каталог на сервере пока
> называются EasyFood — переименуйте их, когда будет удобно: старые адреса
> репозитория GitHub перенаправляет, а данные в томах и базе сохраняются
> (см. [«Переход с EasyFood»](#переход-с-easyfood)).

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
git clone https://github.com/ArseniyKvasov/EasyFood.git   # пока старое имя репозитория
cd EasyFood

cp .env.example .env
```

Отредактируйте `.env`:

```bash
nano .env
```

```ini
# Порты двух слотов: blue и green. Деплой поднимает свободный слот,
# переключает nginx на него и только потом гасит старый.
APP_PORT=8080
APP_PORT_GREEN=8081
APP_BIND=127.0.0.1

# Публичный адрес сайта: по нему deploy/production.sh проверяет выкладку
SITE_URL=https://food.fastclass.ru

# Доступ к базе — задайте СВОЙ пароль
POSTGRES_USER=bitebalance
POSTGRES_PASSWORD=CHANGE_ME_strong_password
POSTGRES_DB=bitebalance

# CORS не нужен, если фронтенд и API отдаёт один и тот же nginx
CORS_ORIGIN=

# Вход через Яндекс ID (обязательно, см. раздел ниже)
YANDEX_CLIENT_ID=
YANDEX_CLIENT_SECRET=
YANDEX_REDIRECT_URI=https://food.fastclass.ru/api/auth/yandex/callback
YANDEX_SCOPE=login:info login:email

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

### Вход через Яндекс ID

Логина с паролем нет — вход только через аккаунт Яндекса. Приложение
создаётся один раз:

1. <https://oauth.yandex.ru> → **«Создать приложение»** → платформа
   **«Веб-сервисы»**.
2. **Redirect URI**: `https://food.fastclass.ru/api/auth/yandex/callback` —
   дословно этот адрес, включая схему и путь. Можно добавить второй адрес для
   локальной разработки: `http://localhost:3000/api/auth/yandex/callback`.
3. Права: только **«Доступ к адресу электронной почты»** и **«Доступ к логину,
   имени и фамилии, полу»**. Этого хватает: имя, фамилия и почта. Имя и фамилия
   идут одним правом вместе с логином и полом, отдельного права на имя нет.
4. ClientID и Client secret — в `.env`:

```bash
YANDEX_CLIENT_ID=...
YANDEX_CLIENT_SECRET=...
YANDEX_REDIRECT_URI=https://food.fastclass.ru/api/auth/yandex/callback
YANDEX_SCOPE=login:info login:email
```

`YANDEX_REDIRECT_URI` должен совпадать с настройкой приложения: при
расхождении Яндекс вернёт `redirect_uri mismatch` и вход закончится экраном
с ошибкой. Пустое значение — адрес собирается из заголовков
`x-forwarded-proto` и `Host` (удобно локально, но в продакшене лучше задать
явно).

Сессия живёт 30 дней, выход — «Выйти из аккаунта» в настройках. Миграция
`007_yandex_auth` удаляет пароли и старые сессии; прежние аккаунты остаются в
базе, но `yandex_id` у них пустой. Привязать старый дневник к Яндексу:

```bash
docker compose exec -T db psql -U bitebalance bitebalance -c \
  "UPDATE users SET yandex_id = '<id>', login = '<логин>' WHERE id = <id аккаунта>;"
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
docker compose exec -T db psql -U bitebalance -d bitebalance \
  -c "SELECT count(*) FROM products WHERE user_id IS NULL AND source = 'np';" \
  -c "SELECT provider, used FROM api_usage;"
```

### Фото: base64 вместо хранилища

Отдельного хранилища нет. Браузер ужимает снимок до 1024 px, кодирует его в
base64 (data URL) и отправляет прямо в теле запроса `POST /api/recognize`.
Сервер держит байты только на время запроса к ИИ и сразу их выбрасывает:
ничего не сохраняется ни на диске, ни в облаке.

Ограничения: тело запроса — до 12 МБ (`bodyLimit` в `backend/src/server.ts`),
сама картинка в base64 — до 8 МБ.

### Бэкапы базы

Сервис `maintenance` раз в `BACKUP_INTERVAL_HOURS` делает `pg_dump`, сжимает
его gzip и кладёт в локальную папку `BACKUP_DIR` (по умолчанию `data/backups`).
Дампы старше `BACKUP_KEEP_DAYS` дней удаляются.

```bash
BACKUP_DIR=data/backups    # относительный путь — от корня проекта
BACKUP_KEEP_DAYS=14        # сколько дней хранить дампы
```

В Docker папка смонтирована томом `backups` — дампы переживают
пересоздание контейнера. Забрать их на хост:

```bash
docker compose cp maintenance:/app/data/backups ./backups
```

`OPENAI_REASONING_EFFORT` уходит в OpenRouter как `reasoning.effort`
(`low`/`minimal`/`medium`/`high`/`xhigh`/`max`/`none`). Пустое значение —
параметр не отправляется, и модель думает на своём дефолте (у Haiku 5.5 это
`medium`).

### Напоминания (Web Push)

Браузер подписывается на push при открытии сайта: если разрешение ещё не
спрашивали, оно запрашивается заново при каждой загрузке страницы. Подписка
привязана к аккаунту и лежит в таблице `push_subscriptions`.

Каждый день в 07:00, 13:00, 17:00 и 20:30 МСК сервер рассылает push
«You can now». Доставка работает и с закрытой вкладкой, но только по HTTPS
(или на localhost) — этого требует браузер.

Ключи VAPID генерируются один раз и прописываются в `.env`:

```bash
npm run vapid
```

```bash
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@example.com
```

Без ключей напоминания выключены: `/api/push/status` вернёт `enabled: false`,
а приложение продолжит работать как обычно.

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
> `git clone git@github.com:ArseniyKvasov/EasyFood.git` (пока старое имя)

---

## 4. Запуск

Первый запуск - тем же скриптом, что и обновления:

```bash
./deploy/production.sh
docker compose ps
```

Скрипт соберёт образ, поднимет стек и дождётся healthcheck. Если базы ещё нет,
он просто пропустит бэкап.

Приложение поднимется на `127.0.0.1:8080`. Проверка:

```bash
curl -s http://127.0.0.1:8080/api/health
# {"ok":true,"version":"1.0.0"}
```

---

## 5. nginx (сначала только HTTP)

На этом шаге ставим конфиг **без HTTPS** - полный конфиг ссылается на сертификат
Let's Encrypt, которого ещё нет, и nginx не сможет запуститься.

```bash
apt install -y nginx
mkdir -p /var/www/certbot
cp deploy/nginx/food.fastclass.ru.http.conf /etc/nginx/sites-available/food.fastclass.ru
ln -sf /etc/nginx/sites-available/food.fastclass.ru /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Альтернатива: пропустить этот шаг, и деплой-скрипт сам создаст конфиг при первом
запуске (см. «Слоты и nginx» ниже). Но тогда до выпуска сертификата site будет
проксировать HTTP-слот full-конфигом, который требует сертификат, - поэтому на
свежем сервере проще пройти шаги 5-6 по инструкции, а скрипт далее обновляет
только порт в готовом конфиге.

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

Теперь сертификат существует - включаем HTTPS. Дальше порт в этом конфиге
обновляет деплой-скрипт; руками конфиг больше не трогаем.

```bash
cd /opt/EasyFood
cp deploy/nginx/food.fastclass.ru.conf /etc/nginx/sites-available/food.fastclass.ru
sed -i 's/127\.0\.0\.1:8080/127.0.0.1:'"$APP_PORT"'/' /etc/nginx/sites-available/food.fastclass.ru
nginx -t && systemctl reload nginx
```

Не переписывайте конфиг из репозитория после этого: он содержит порт 8080,
а активный слот может быть на другом.

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

Одна команда на сервере:

```bash
cd /opt/EasyFood
./deploy/production.sh
```

Деплой без простоя: приложение живёт в двух слотах - `app-blue` на `APP_PORT`
и `app-green` на `APP_PORT_GREEN`. Пока один слот обслуживает трафик, второй
собирается и проверяется.

Что делает скрипт:

1. читает `.env` (`SITE_URL`, порты, доступы) и проверяет docker/curl;
2. обновляет код из git - рабочий каталог должен быть чистым;
3. делает бэкап базы в `data/backups/predeploy-*.sql.gz` перед миграциями;
4. собирает образ и помечает его коротким SHA коммита;
5. поднимает свободный слот и ждёт его healthcheck на
   `127.0.0.1:<порт слота>/api/health`;
6. меняет порт приложения в конфиге nginx (`NGINX_SITE_FILE`) и делает
   `nginx -s reload`;
7. проверяет публичный `$SITE_URL/api/health`; если не ответил - возвращает
   nginx на старый порт и гасит кандидата;
8. гасит старый слот, обновляет `maintenance` и пишет
   `.runtime/deploy/active-slot`;
9. чистит старые образы, оставляя три последних релиза.

Если кандидат не прошёл healthcheck, он просто останавливается: трафик
продолжает идти на старый слот, nginx не трогается. Nginx получает reload,
поэтому уже открытые соединения дорабатывают на старом слоте.

### Слоты и nginx

- `APP_PORT` - порт слота blue, `APP_PORT_GREEN` - слота green; они не должны
  совпадать.
- Если конфига `/etc/nginx/sites-available/<домен>` ещё нет, скрипт создаёт его
  сам из шаблона `deploy/nginx/food.fastclass.ru.conf`: подставляет ваш домен
  вместо `food.fastclass.ru`, ставит порт активного слота, включает сайт в
  `sites-enabled` и делает `nginx -s reload`. Права на запись в
  `/etc/nginx/sites-available` нужны - запускайте деплой от root или через
  `sudo`.
- На серверах, где 443 обслуживает SNI-прокси, задайте `NGINX_SNI=1`: скрипт
  возьмёт шаблон `food.fastclass.ru.sni.conf` (TLS там завершает stream-слой,
  порт 8448 не переключается).
- Скрипт сам меняет `127.0.0.1:<порт>` в установленном конфиге nginx
  (`NGINX_SITE_FILE` переопределяет путь). Не перезаписывайте этот конфиг
  вручную из репозитория после деплоя - вернётся старый порт.
- Какой слот активен, видно в `.runtime/deploy/active-slot` и по порту в
  конфиге nginx.

Опции: `--no-pull` (выложить текущий код), `--no-backup`, `--no-prune`,
`--check` (только проверка окружения, ничего не меняется).

```bash
./deploy/production.sh --check
```

Ручной `docker compose up -d` поднимает оба слота сразу и перезапускает
активный, поэтому для выкладки используйте скрипт.

Миграции применяются автоматически при старте контейнера (`backend/src/migrations.ts`).

Сервис `maintenance` (бэкапы базы и чистка истории) обновляется тем же образом —
он собран из того же образа.

### Переход с EasyFood

Переименование не требует переноса данных: тома в `docker-compose.yml`
закреплены за прежними именами (`easyfood_easyfood-db`,
`easyfood_easyfood-backups`), а роль и база остаются те, что записаны в
`.env` (`POSTGRES_USER`, `POSTGRES_DB` — у старой установки это
`easyfood`). В этом случае в командах `psql` подставляйте
`-U easyfood easyfood`.

1. Остановите старый стек: у него другое имя проекта, и порт 8080 освободится
   только после остановки.

   ```bash
   cd /opt/EasyFood && docker compose down
   ```

2. Поднимите стек под новым именем - скрипт сам сделает `git pull`, сборку и
   healthcheck:

   ```bash
   ./deploy/production.sh
   ```

   Первый запуск собирает образ, поэтому сайт будет недоступен несколько
   минут. Дальше деплой идёт без простоя. Пока контейнеры старого стека
   (`easyfood-*`) запущены, скрипт откажется работать: два Postgres на одном
   томе повредят базу.

3. Войдите заново: куки переименованы (`ef_session` → `bb_session`,
   `ef_oauth` → `bb_oauth`), старые сессии больше не действуют.

Проверьте, что данные на месте:

```bash
docker compose exec -T db psql -U easyfood easyfood -c "SELECT count(*) FROM entries;"
```

---

## 10. Бэкапы

### Автоматически в локальную папку

Сервис `maintenance` делает дамп базы и кладёт его в `BACKUP_DIR`
(в Docker — том `backups`):

```bash
docker compose ps maintenance            # статус
docker compose logs -f maintenance       # логи
```

Расписание — переменными в `.env`:

```bash
BACKUP_INTERVAL_HOURS=24                 # как часто делать дамп
BACKUP_KEEP_DAYS=14                      # сколько дней хранить
```

Разовый бэкап вручную:

```bash
docker compose exec maintenance node backend/dist/scripts/maintenance.js --once
```

### Ручной дамп

```bash
# Дамп базы
docker compose exec -T db pg_dump -U bitebalance bitebalance | gzip > backup-$(date +%F).sql.gz

# Восстановление
gunzip -c backup-2026-10-21.sql.gz | docker compose exec -T db psql -U bitebalance bitebalance
```

### Восстановление из дампа

```bash
# Забрать дампы из тома на хост
docker compose cp maintenance:/app/data/backups ./backups

# Залить в базу
gunzip -c backups/bitebalance-2026-10-21T03-00-00.sql.gz | docker compose exec -T db psql -U bitebalance bitebalance
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
docker compose exec -T db psql -U bitebalance bitebalance \
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

**«Вход через Яндекс не настроен»** — пустые `YANDEX_CLIENT_ID`/`YANDEX_CLIENT_SECRET`
или контейнер не перезапущен после правки `.env`:
`docker compose up -d` и `docker compose logs app | grep -i yandex`.

**«Сессия входа истекла» / `redirect_uri mismatch`** — `YANDEX_REDIRECT_URI`
не совпадает с Redirect URI в приложении Яндекса, либо браузер не пустил
cookie (например, блокировщик). Проверьте адрес и повторите вход.

**Не находится продукт по штрихкоду** — проверьте, что сервер ходит в интернет:
`docker compose exec app wget -qO- https://world.openfoodfacts.org/api/v2/product/4600000000001.json | head -c 100`.
