#!/usr/bin/env bash
set -Eeuo pipefail

# Zero-downtime деплой BiteBalance.
#
#   ./deploy/production.sh
#
# Схема blue/green: приложение живёт в двух слотах - app-blue на APP_PORT и
# app-green на APP_PORT_GREEN. Деплой поднимает свободный слот, проверяет его
# healthcheck, переключает nginx на его порт и только потом гасит старый.
# Nginx получает reload, поэтому открытые соединения не рвутся.
#
# Что делает:
#   1. проверяет окружение, .env и конфиг nginx
#   2. обновляет код из git (если не указан --no-pull)
#   3. делает бэкап базы перед миграциями
#   4. собирает образ
#   5. поднимает свободный слот и ждёт его healthcheck
#   6. переключает nginx и проверяет публичный адрес
#   7. гасит старый слот, обновляет maintenance, чистит образы
#
# SITE_URL берётся из .env; переменная окружения важнее файла.

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

ENV_FILE="${BITEBALANCE_ENV_FILE:-$APP_DIR/.env}"
IMAGE="bitebalance-app"
SLOT_FILE="$APP_DIR/.runtime/deploy/active-slot"

PULL=1
BACKUP=1
PRUNE=1
CHECK=0
DEPLOY_DONE=0
CAND_STARTED=0
SWITCHED=0
NGINX_NEEDS_CREATE=0

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Zero-downtime деплой BiteBalance на сервер.

  ./deploy/production.sh [опции]

Опции:
  --no-pull     не делать git pull, выложить текущий код
  --no-backup   не делать бэкап базы перед миграциями
  --no-prune    не чистить старые образы
  --check       только проверить окружение и .env, ничего не менять
  -h, --help    эта справка

SITE_URL, APP_PORT, APP_PORT_GREEN и NGINX_SITE_FILE берутся из .env
(переменная окружения важнее файла).
EOF
}

while (($#)); do
  case "$1" in
    --no-pull) PULL=0 ;;
    --no-backup) BACKUP=0 ;;
    --no-prune) PRUNE=0 ;;
    --check) CHECK=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "неизвестная опция: $1 (см. --help)" ;;
  esac
  shift
done

# Читает значение из dotenv-файла без source: в .env бывают строки,
# невалидные для shell.
file_value() {
  local file="$1" expected_key="$2" line key value
  [[ -r "$file" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    key="${key//[[:space:]]/}"
    [[ "$key" == "$expected_key" ]] || continue
    value="${line#*=}"
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"
    printf '%s' "$value"
    return 0
  done < "$file"
  return 1
}

dotenv_value() { file_value "$ENV_FILE" "$1"; }

# Значение из .env с запасным вариантом.
env_or() {
  local key="$1" fallback="$2" value
  value="$(dotenv_value "$key" || true)"
  printf '%s' "${value:-$fallback}"
}

wait_http() {
  local url="$1" attempts="$2" interval="$3" i last=""
  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      return 0
    fi
    last="$(curl -sS --max-time 3 "$url" 2>&1 | head -1)"
    sleep "$interval"
  done
  log "wait_http: не дождался ответа $url (последняя ошибка: ${last:-нет})"
  return 1
}

reload_nginx() {
  if nginx -s reload >/dev/null 2>&1; then
    return 0
  fi
  if command -v systemctl >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# Меняет порт приложения в конфиге сайта и перезагружает nginx.
# При любой ошибке возвращает исходный файл.
nginx_switch() {
  local old_port="$1" new_port="$2" tmp backup reason
  if [[ ! -f "$NGINX_SITE_FILE" ]]; then
    log "nginx_switch: нет файла $NGINX_SITE_FILE"
    return 1
  fi
  if ! grep -q "127.0.0.1:${old_port}" "$NGINX_SITE_FILE"; then
    log "nginx_switch: в конфиге нет порта ${old_port} - проверьте $NGINX_SITE_FILE"
    return 1
  fi
  tmp="$(mktemp "${TMPDIR:-/tmp}/bitebalance-nginx.XXXXXX")"
  backup="$(mktemp "${TMPDIR:-/tmp}/bitebalance-nginx-backup.XXXXXX")"
  cp "$NGINX_SITE_FILE" "$backup"
  sed "s/127\.0\.0\.1:${old_port}\([^0-9]\)/127.0.0.1:${new_port}\1/g" "$NGINX_SITE_FILE" > "$tmp"
  if ! grep -q "127.0.0.1:${new_port}" "$tmp"; then
    rm -f "$tmp" "$backup"
    log "nginx_switch: замена порта не сработала"
    return 1
  fi
  cp "$tmp" "$NGINX_SITE_FILE"
  if ! nginx -t >/dev/null 2>&1; then
    log "nginx_switch: nginx -t не прошёл с портом ${new_port}, полный вывод:"
    nginx -t 2>&1 | tail -8 | sed 's/^/    /' >&2
    cp "$backup" "$NGINX_SITE_FILE"
    rm -f "$tmp" "$backup"
    return 1
  fi
  if ! reload_nginx; then
    log "nginx_switch: не удалось перезагрузить nginx"
    cp "$backup" "$NGINX_SITE_FILE"
    reload_nginx || true
    rm -f "$tmp" "$backup"
    return 1
  fi
  rm -f "$tmp" "$backup"
  return 0
}

# Определяет, какой слот сейчас обслуживает трафик: смотрим на порт в конфиге
# nginx, затем на файл состояния, затем на запущенные контейнеры.
detect_active() {
  local port=""
  if [[ -f "$NGINX_SITE_FILE" ]]; then
    # Только строки proxy_pass: в SNI-конфиге раньше встречается listen 127.0.0.1:8448.
    port="$(grep -E 'proxy_pass[[:space:]]+http://127\.0\.0\.1:' "$NGINX_SITE_FILE" \
      | head -n 1 | grep -oE '127\.0\.0\.1:[0-9]+' | cut -d: -f2 || true)"
  fi
  if [[ -z "$port" && -f "$SLOT_FILE" ]]; then
    port="$(file_value "$SLOT_FILE" PORT || true)"
  fi
  if [[ "$port" == "$GREEN_PORT" ]]; then
    ACTIVE_SLOT=green
  elif [[ "$port" == "$BLUE_PORT" ]]; then
    ACTIVE_SLOT=blue
  elif [[ -n "$(docker compose ps -q app-green 2>/dev/null || true)" ]]; then
    ACTIVE_SLOT=green
  else
    ACTIVE_SLOT=blue
  fi
  if [[ "$ACTIVE_SLOT" == "blue" ]]; then
    ACTIVE_PORT="$BLUE_PORT"
    CAND_SLOT=green
    CAND_PORT="$GREEN_PORT"
  else
    ACTIVE_PORT="$GREEN_PORT"
    CAND_SLOT=blue
    CAND_PORT="$BLUE_PORT"
  fi
}

write_state() {
  local tmp="$SLOT_FILE.tmp.$$"
  mkdir -p "$(dirname "$SLOT_FILE")"
  {
    printf 'SLOT=%s\n' "$CAND_SLOT"
    printf 'PORT=%s\n' "$CAND_PORT"
    printf 'RELEASE=%s\n' "${GIT_SHA:-unknown}"
    printf 'UPDATED=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  } > "$tmp"
  mv -f "$tmp" "$SLOT_FILE"
}

on_error() {
  local code=$?
  trap - ERR
  printf '\n'
  log "деплой прерван (код $code)"
  if ((DEPLOY_DONE)); then
    exit "$code"
  fi
  if ((SWITCHED)); then
    log "возвращаем nginx на порт $ACTIVE_PORT"
    nginx_switch "$CAND_PORT" "$ACTIVE_PORT" || true
  fi
  if ((CAND_STARTED)); then
    docker compose stop "app-$CAND_SLOT" >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap on_error ERR

# ---------- Проверки ----------

[[ -f "$ENV_FILE" ]] || die "не найден $ENV_FILE: скопируйте .env.example в .env"

SITE_URL="${SITE_URL:-$(dotenv_value SITE_URL || true)}"
SITE_URL="${SITE_URL%/}"
if [[ -z "$SITE_URL" ]]; then
  die "SITE_URL не задан: добавьте в $ENV_FILE строку SITE_URL=https://ваш-домен"
fi
if [[ ! "$SITE_URL" =~ ^https?://([A-Za-z0-9.-]+)(:[0-9]{1,5})?$ ]]; then
  die "SITE_URL должен быть вида https://example.com без пути"
fi
SITE_HOST="$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"

BLUE_PORT="$(env_or APP_PORT 8080)"
GREEN_PORT="$(env_or APP_PORT_GREEN 8081)"
APP_BIND="$(env_or APP_BIND 127.0.0.1)"
if [[ ! "$BLUE_PORT" =~ ^[0-9]+$ || ! "$GREEN_PORT" =~ ^[0-9]+$ ]]; then
  die "APP_PORT и APP_PORT_GREEN должны быть числами"
fi
if [[ "$BLUE_PORT" == "$GREEN_PORT" ]]; then
  die "APP_PORT и APP_PORT_GREEN не должны совпадать"
fi
HEALTH_HOST="$APP_BIND"
if [[ -z "$HEALTH_HOST" || "$HEALTH_HOST" == "0.0.0.0" ]]; then
  HEALTH_HOST="127.0.0.1"
fi
NGINX_SITE_FILE="${NGINX_SITE_FILE:-/etc/nginx/sites-available/$SITE_HOST}"
POSTGRES_USER="$(env_or POSTGRES_USER bitebalance)"
POSTGRES_DB="$(env_or POSTGRES_DB bitebalance)"

for cmd in docker curl gzip; do
  command -v "$cmd" >/dev/null 2>&1 || die "не найдена команда: $cmd"
done
docker compose version >/dev/null 2>&1 || die "нужен Docker Compose v2 (docker compose)"
if ((PULL)); then
  command -v git >/dev/null 2>&1 || die "не найдена команда: git"
fi

if [[ ! -f "$NGINX_SITE_FILE" ]]; then
  if ((CHECK)); then
    log "WARNING: не найден $NGINX_SITE_FILE - при деплое будет создан из шаблона"
  else
    NGINX_NEEDS_CREATE=1
  fi
fi

[[ -n "$(dotenv_value YANDEX_CLIENT_ID || true)" && -n "$(dotenv_value YANDEX_CLIENT_SECRET || true)" ]] \
  || log "WARNING: YANDEX_CLIENT_ID/SECRET пусты - войти на сайт не получится"

# Переход со старого стека: его Postgres держит тот же том, а второй экземпляр
# на одном каталоге данных повредит базу.
legacy_running=""
for legacy in easyfood-db easyfood-app easyfood-maintenance; do
  if [[ -n "$(docker ps -q --filter "name=^/${legacy}$" 2>/dev/null || true)" ]]; then
    legacy_running="${legacy_running:+${legacy_running}, }${legacy}"
  fi
done
if [[ -n "$legacy_running" ]]; then
  if ((CHECK)); then
    log "WARNING: запущен старый стек ($legacy_running) - перед деплоем его нужно остановить"
  else
    die "запущен старый стек ($legacy_running) - остановите его: cd /opt/EasyFood && docker compose down"
  fi
fi

# Один деплой за раз: параллельный запуск подменит слот под работающим.
LOCK_FILE="$APP_DIR/.runtime/deploy.lock"
mkdir -p "$(dirname "$LOCK_FILE")"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "деплой уже запущен (${LOCK_FILE})"
fi

if ((CHECK)); then
  log "проверка пройдена: SITE_URL=$SITE_URL, слоты blue=:$BLUE_PORT green=:$GREEN_PORT, база=$POSTGRES_DB"
  log "nginx: $NGINX_SITE_FILE"
  log "режим --check: ничего не меняю"
  exit 0
fi

# ---------- Конфиг nginx ----------

# Если конфига сайта ещё нет (первый деплой на чистом сервере), собираем его
# из шаблона репозитория: обычный вариант или вариант для SNI-прокси.
ensure_nginx_site() {
  local template enabled mode
  if [[ -f "$NGINX_SITE_FILE" ]]; then
    log "nginx: конфиг уже существует, пропускаю создание: $NGINX_SITE_FILE"
    return 0
  fi
  mode="${NGINX_SNI:-0}"
  if [[ "$mode" == "1" ]]; then
    template="$APP_DIR/deploy/nginx/food.fastclass.ru.sni.conf"
  else
    template="$APP_DIR/deploy/nginx/food.fastclass.ru.conf"
  fi
  [[ -f "$template" ]] || die "не найден шаблон $template"
  if ! mkdir -p "$(dirname "$NGINX_SITE_FILE")"; then
    die "нет прав на $(dirname "$NGINX_SITE_FILE") (запустите деплой от root или через sudo)"
  fi
  log "nginx: создаю конфиг $NGINX_SITE_FILE из ${template##*/} (SNI=$mode, домен $SITE_HOST, слот :$ACTIVE_PORT)"

  if [[ "$mode" == "1" ]]; then
    # В SNI-варианте TLS завершает stream-слой общим сертификатом сервера
    # (food.fastclass.ru). Пути к сертам не трогаем, иначе nginx -t упадёт
    # на отсутствующем каталоге для нового домена.
    sed -e "/server_name/s/food\.fastclass\.ru/$SITE_HOST/g" \
        -e "/access_log/s/food\.fastclass\.ru/$SITE_HOST/g" \
        -e "/error_log/s/food\.fastclass\.ru/$SITE_HOST/g" \
        -e "s/127\.0\.0\.1:8080/127.0.0.1:$ACTIVE_PORT/g" \
        "$template" > "$NGINX_SITE_FILE"
    log "nginx: серты оставлены общесерверными, server_name=$SITE_HOST"
    if [[ -n "${NGINX_STREAM_CONF:-}" ]]; then
      if [[ -f "$NGINX_STREAM_CONF" ]]; then
        if ! grep -q "$SITE_HOST" "$NGINX_STREAM_CONF"; then
          log "WARNING: в $NGINX_STREAM_CONF нет строки для $SITE_HOST - добавьте:"
          log "WARNING:   $SITE_HOST 127.0.0.1:8447;   (в map) и server на listen 127.0.0.1:8447"
        else
          log "nginx: stream-map содержит $SITE_HOST - ок"
        fi
      else
        log "WARNING: NGINX_STREAM_CONF=$NGINX_STREAM_CONF не существует - проверьте путь"
      fi
    else
      log "WARNING: NGINX_STREAM_CONF не задан - не проверить stream-map"
    fi
  else
    sed -e "s/food\.fastclass\.ru/$SITE_HOST/g" "$template" > "$NGINX_SITE_FILE"
    sed -i.bak "s/127\.0\.0\.1:8080/127.0.0.1:$ACTIVE_PORT/g" "$NGINX_SITE_FILE" && rm -f "$NGINX_SITE_FILE.bak"
    log "nginx: порты слотов проставлены на :$ACTIVE_PORT"
  fi

  # Включаем сайт и предупреждаем про дефолтный.
  enabled="/etc/nginx/sites-enabled/$(basename "$NGINX_SITE_FILE")"
  if [[ -d /etc/nginx/sites-enabled && ! -e "$enabled" ]]; then
    ln -sf "$NGINX_SITE_FILE" "$enabled" \
      || log "WARNING: не удалось включить сайт: ln -sf $NGINX_SITE_FILE $enabled"
    if [[ -e /etc/nginx/sites-enabled/default ]]; then
      log "WARNING: в sites-enabled есть default - проверьте, что он не перехватывает домен"
    fi
  fi

  if ! nginx -t >/dev/null 2>&1; then
    log "nginx: nginx -t не прошёл, полный вывод:"
    nginx -t 2>&1 | sed 's/^/    /' >&2 || true
    # Частая причина: сертификата для нового домена ещё нет (шаблон ссылается
    # на /etc/letsencrypt/live/<домен>/). Подменяем HTTP-шаблоном без SSL.
    if [[ "$mode" != "1" ]]; then
      local http_template="$APP_DIR/deploy/nginx/food.fastclass.ru.http.conf"
      if [[ -f "$http_template" ]]; then
        sed -e "s/food\.fastclass\.ru/$SITE_HOST/g" "$http_template" > "$NGINX_SITE_FILE"
        sed -i.bak "s/127\.0\.0\.1:8080/127.0.0.1:$ACTIVE_PORT/g" "$NGINX_SITE_FILE" && rm -f "$NGINX_SITE_FILE.bak"
        log "nginx: поставлен HTTP-конфиг без SSL (сертификат для $SITE_HOST не найден)"
        log "nginx: выпустите сертификат: certbot --nginx -d $SITE_HOST --redirect"
        if nginx -t >/dev/null 2>&1; then
          reload_nginx || log "WARNING: не удалось перезагрузить nginx"
          log "nginx: HTTP-конфиг активен"
          return 0
        fi
        log "nginx: HTTP-конфиг тоже не прошёл проверку:"
        nginx -t 2>&1 | sed 's/^/    /' >&2 || true
      fi
    fi
    # nginx -t проверяет все конфиги: битым может оказаться чужой файл.
    if [[ -d /etc/nginx/sites-enabled ]]; then
      log "nginx: файлы в sites-enabled:"
      ls -la /etc/nginx/sites-enabled/ 2>&1 | sed 's/^/    /' >&2 || true
    fi
    log "WARNING: nginx -t не прошёл после создания конфига - проверьте $NGINX_SITE_FILE вручную"
    return 1
  fi
  reload_nginx \
    && log "nginx: конфиг проверен и перезагружен" \
    || log "WARNING: не удалось перезагрузить nginx (сервис может быть не запущен)"
  return 0
}

# ---------- Код ----------

if ((PULL)); then
  [[ -d "$APP_DIR/.git" ]] || die "$APP_DIR не git-репозиторий (запустите с --no-pull)"
  if [[ -n "$(git status --porcelain)" ]]; then
    die "в рабочем дереве есть незакоммиченные изменения - закоммитьте или запустите с --no-pull"
  fi
  log "обновляем код из git"
  git fetch --quiet --prune
  git pull --ff-only --quiet
fi
GIT_SHA="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || true)"

# ---------- Бэкап перед миграциями ----------

if ((BACKUP)); then
  backup_dir="$APP_DIR/data/backups"
  mkdir -p "$backup_dir"
  if [[ -n "$(docker compose ps -q db 2>/dev/null || true)" ]]; then
    backup_file="$backup_dir/predeploy-$(date '+%Y%m%d-%H%M%S').sql.gz"
    log "бэкап базы перед миграциями"
    docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      --clean --if-exists --no-owner | gzip > "$backup_file"
    log "бэкап: $backup_file ($(du -h "$backup_file" | cut -f1))"
  else
    log "WARNING: контейнер db не запущен - бэкап пропущен"
  fi
fi

# ---------- Сборка ----------

log "собираем образ $IMAGE"
docker compose build app-blue
if [[ -n "$GIT_SHA" ]]; then
  docker tag "$IMAGE:latest" "$IMAGE:$GIT_SHA"
  log "образ помечен тегом $GIT_SHA"
fi

# ---------- Кандидат ----------

detect_active
log "активный слот: $ACTIVE_SLOT (:$ACTIVE_PORT), кандидат: $CAND_SLOT (:$CAND_PORT)"

if [[ "${NGINX_NEEDS_CREATE:-0}" == "1" ]]; then
  ensure_nginx_site || log "WARNING: конфиг nginx не создан - трафик переключать не на что"
fi

log "проверяем базу"
docker compose up -d --no-deps db >/dev/null
db_state=""
for ((i = 1; i <= 60; i++)); do
  db_id="$(docker compose ps -q db 2>/dev/null || true)"
  if [[ -n "$db_id" ]]; then
    db_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_id" 2>/dev/null || true)"
  fi
  [[ "$db_state" == "healthy" || "$db_state" == "running" ]] && break
  sleep 2
done
[[ "$db_state" == "healthy" || "$db_state" == "running" ]] || die "база не поднялась"

log "поднимаем кандидата app-$CAND_SLOT"
CAND_STARTED=1
docker compose up -d --no-deps --force-recreate --no-build "app-$CAND_SLOT"

log "ждём healthcheck кандидата"
if ! wait_http "http://$HEALTH_HOST:$CAND_PORT/api/health" 60 2; then
  log "кандидат не ответил на http://$HEALTH_HOST:$CAND_PORT/api/health"
  docker compose logs --tail 60 "app-$CAND_SLOT" 2>&1 | sed 's/^/    /' >&2 || true
  docker compose stop "app-$CAND_SLOT" >/dev/null 2>&1 || true
  die "деплой прерван: старый слот продолжает работать"
fi
log "кандидат отвечает"

# ---------- Переключение трафика ----------

log "переключаем nginx на порт $CAND_PORT"
if ! nginx_switch "$ACTIVE_PORT" "$CAND_PORT"; then
  log "nginx_switch не удался - состояние конфига:"
  grep -nE "listen|proxy_pass|ssl_certificate|server_name" "$NGINX_SITE_FILE" 2>/dev/null | sed "s/^/    /" >&2 || true
  docker compose stop "app-$CAND_SLOT" >/dev/null 2>&1 || true
  die "не удалось переключить nginx на порт $CAND_PORT"
fi
SWITCHED=1

if ! wait_http "$SITE_URL/api/health" 10 1; then
  # Локальный healthcheck уже прошёл: кандидат жив. Если публичный адрес не
  # отвечает, дело обычно вне приложения - DNS, TLS, фаервол. Откатывать
  # рабочее приложение из-за этого нельзя.
  log "WARNING: $SITE_URL/api/health не ответил - проверьте DNS, TLS и фаервол"
  log "WARNING: деплой продолжен, nginx переключён на порт $CAND_PORT"
else
  log "публичный адрес отвечает: $SITE_URL"
fi

# ---------- Вывод старого слота ----------

log "гасим старый слот app-$ACTIVE_SLOT"
docker compose stop "app-$ACTIVE_SLOT" >/dev/null 2>&1 || true
# Контейнер из версии без слотов: после переключения он больше не нужен.
docker rm -f bitebalance-app >/dev/null 2>&1 || true

docker compose up -d --no-deps --force-recreate --no-build maintenance >/dev/null 2>&1 \
  || log "WARNING: не удалось обновить maintenance - перезапустите его вручную"

write_state
DEPLOY_DONE=1

# ---------- Уборка ----------

if ((PRUNE)); then
  docker image prune -f >/dev/null 2>&1 || true
  # Оставляем три последних релизных тега, остальные удаляем.
  docker image ls "$IMAGE" --format '{{.CreatedAt}} {{.Tag}}' \
    | awk '$NF != "latest"' \
    | sort -r \
    | awk 'NR > 3 { print $NF }' \
    | while read -r tag; do
        docker rmi "$IMAGE:$tag" >/dev/null 2>&1 || true
      done
  log "старые образы удалены"
fi

log "готово: ${GIT_SHA:-без git}, слот $CAND_SLOT на :$CAND_PORT, $SITE_URL"
docker compose ps
