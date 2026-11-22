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
#   1. проверяет окружение, .env, права и конфиг nginx
#   2. проверяет сертификат: если его нет (или он истекает) - пробует
#      выпустить/продлить через Let's Encrypt и включить HTTPS
#   3. обновляет код из git (если не указан --no-pull)
#   4. поднимает базу и делает бэкап перед миграциями
#   5. собирает образ
#   6. поднимает свободный слот и ждёт его healthcheck
#   7. переключает nginx и проверяет публичный адрес
#   8. гасит старый слот, обновляет maintenance, чистит образы
#
# Любая ошибка печатает, что именно упало, код возврата, хвост вывода и что
# делать дальше. Полный лог деплоя пишется в .runtime/deploy/logs/.
#
# SITE_URL и остальные настройки берутся из .env; переменные окружения —
# только запасной вариант, если ключа в файле нет.

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

ENV_FILE="${BITEBALANCE_ENV_FILE:-$APP_DIR/.env}"
IMAGE="bitebalance-app"
SLOT_FILE="$APP_DIR/.runtime/deploy/active-slot"
DEPLOY_LOG=""

PULL=1
BACKUP=1
PRUNE=1
CHECK=0
NO_SSL=0
AUTO_SSL=1
DEPLOY_DONE=0
CAND_STARTED=0
SWITCHED=0

ACTIVE_SLOT=""
ACTIVE_PORT=""
CAND_SLOT=""
CAND_PORT=""
SITE_URL=""
GIT_SHA=""
last_nginx_error=""

# Дублирует строку в файл лога деплоя (если он уже создан).
_log_to_file() {
  if [[ -n "$DEPLOY_LOG" ]]; then
    printf '%s\n' "$*" >>"$DEPLOY_LOG" 2>/dev/null || true
  fi
}

log() {
  local line="[$(date '+%H:%M:%S')] $*"
  printf '%s\n' "$line"
  _log_to_file "$line"
}

warn() {
  local line="[$(date '+%H:%M:%S')] WARNING: $*"
  printf '%s\n' "$line" >&2
  _log_to_file "$line"
}

# Подсказка «что делать» под сообщением об ошибке.
hint() {
  local line="       → $*"
  printf '%s\n' "$line" >&2
  _log_to_file "$line"
}

# Единый формат ошибки: заголовок и подсказки по исправлению.
error_block() {
  local line="[$(date '+%H:%M:%S')] ERROR: $1"
  printf '\n' >&2
  printf '%s\n' "$line" >&2
  _log_to_file ""
  _log_to_file "$line"
  shift
  local item
  for item in "$@"; do
    if [[ -n "$item" ]]; then
      hint "$item"
    fi
  done
}

die() {
  local msg="$1"
  shift
  error_block "$msg" "$@"
  rollback_on_failure
  exit 1
}

usage() {
  cat <<'EOF'
Zero-downtime деплой BiteBalance на сервер.

  ./deploy/production.sh [опции]

Опции:
  --no-pull     не делать git pull, выложить текущий код
  --no-backup   не делать бэкап базы перед миграциями
  --no-prune    не чистить старые образы
  --no-ssl      не выпускать сертификат автоматически
  --check       только проверить окружение, .env и сертификат, ничего не менять
  -h, --help    эта справка

SITE_URL, APP_PORT, APP_PORT_GREEN, NGINX_SITE_FILE, NGINX_SNI и LE_EMAIL
берутся из .env (значения из файла важнее переменных окружения).

Сертификат: скрипт проверяет /etc/letsencrypt/live/<домен>/ и, если сертификата
нет, пробует выпустить его через certbot (webroot). Нужны установленный certbot
и доступный снаружи порт 80. После выпуска HTTPS-конфиг включается сам.
Нестандартные случаи:

  AUTO_SSL_INSTALL=1   поставить certbot через apt, если его нет
  LE_STAGING=1         тестовый сертификат Let's Encrypt staging
  ACME_WEBROOT=<dir>   каталог ACME-проверок (по умолчанию /var/www/certbot)
  CERT_RENEW_DAYS=30   за сколько дней до истечения продлевать
EOF
}

while (($#)); do
  case "$1" in
    --no-pull) PULL=0 ;;
    --no-backup) BACKUP=0 ;;
    --no-prune) PRUNE=0 ;;
    --no-ssl) NO_SSL=1 ;;
    --check) CHECK=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "неизвестная опция: $1" "список опций: $0 --help" ;;
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

# Настройка: сначала .env, затем переменная окружения, затем значение по
# умолчанию. .env — единственный источник правды для домена и портов.
cfg() {
  local key="$1" fallback="$2" value
  value="$(dotenv_value "$key" || true)"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
    return 0
  fi
  value="$(printenv "$key" 2>/dev/null || true)"
  printf '%s' "${value:-$fallback}"
}

# Выполняет шаг деплоя, дублирует вывод в лог и при ошибке объясняет причину.
#   run_step "что делаем" "что проверить" <команда...>
run_step() {
  local what="$1" advice="$2"
  shift 2
  local step_log="" rc=0
  step_log="$(mktemp "${TMPDIR:-/tmp}/bitebalance-step.XXXXXX")" || step_log=""

  log "$what"
  trap - ERR
  set +e
  if [[ -n "$step_log" ]]; then
    "$@" 2>&1 | tee "$step_log"
    rc="${PIPESTATUS[0]}"
  else
    "$@" 2>&1
    rc=$?
  fi
  set -e
  trap on_error ERR

  # Вывод шага сохраняем в общий лог: по нему видно, что было до ошибки.
  if [[ -n "$step_log" && -n "$DEPLOY_LOG" ]]; then
    cat "$step_log" >>"$DEPLOY_LOG" 2>/dev/null || true
  fi

  if ((rc != 0)); then
    error_block "$what: команда завершилась с кодом $rc" \
      "команда: $*" \
      "$advice"
    if [[ -n "$step_log" ]]; then
      printf '       вывод (последние строки):\n' >&2
      tail -n 25 "$step_log" | sed 's/^/    | /' >&2 || true
      hint "полный вывод: $step_log"
    fi
    rollback_on_failure
    exit "$rc"
  fi
  if [[ -n "$step_log" ]]; then
    rm -f "$step_log"
  fi
  return 0
}

# Краткое описание ответа HTTP: код или текст ошибки curl.
http_state() {
  local url="$1" out="" rc=0
  # trap - ERR внутри подстановки: curl здесь падает штатно, это не ошибка деплоя.
  out="$(trap - ERR; curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>&1)" || rc=$?
  if ((rc == 0)); then
    printf 'HTTP %s' "$out"
  elif [[ "$out" =~ ^[0-9]{3}$ ]]; then
    printf 'HTTP %s (curl код %s)' "$out" "$rc"
  else
    printf '%s' "${out:-curl завершился с кодом $rc}"
  fi
}

# Объясняет типичные причины неудачного HTTP-ответа.
http_failure_hint() {
  case "$1" in
    *"curl код 7"*|*"Connection refused"*)
      hint "порт не слушает: контейнер не поднялся или APP_BIND/APP_PORT не совпадают" ;;
    *"Could not resolve"*|*"resolve host"*)
      hint "DNS: имя не разрешается - проверьте DNS-запись домена" ;;
    *"timed out"*|*"Timeout"*)
      hint "таймаут: трафик режет фаервол или сервер не отвечает" ;;
    *"HTTP 404"*)
      hint "на порту отвечает не приложение: проверьте путь /api/health" ;;
    *"HTTP 502"*|*"HTTP 503"*|*"HTTP 504"*)
      hint "nginx не достучался до приложения: порт в конфиге и порт слота не совпадают" ;;
    *"curl код 6"*)
      hint "DNS: не удалось разрешить имя сервиса" ;;
    *"curl код 28"*)
      hint "таймаут соединения: трафик режет фаервол или сервер не отвечает" ;;
    *"HTTP 5"*)
      hint "приложение ответило ошибкой 5xx: смотрите его логи" ;;
  esac
  return 0
}

wait_http() {
  local url="$1" attempts="$2" interval="$3" i last=""
  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      return 0
    fi
    last="$(http_state "$url")"
    sleep "$interval"
  done
  log "не дождался ответа $url за $((attempts * interval)) с (последний ответ: ${last:-нет ответа})"
  http_failure_hint "$last"
  return 1
}

# --- nginx ---

# Перезагружает nginx, запоминая причину ошибки для сообщения пользователю.
reload_nginx() {
  local out=""
  if out="$(nginx -s reload 2>&1)"; then
    last_nginx_error=""
    return 0
  fi
  if command -v systemctl >/dev/null 2>&1 && out="$(systemctl reload nginx 2>&1)"; then
    last_nginx_error=""
    return 0
  fi
  last_nginx_error="${out:-нет вывода}"
  return 1
}

nginx_running() {
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet nginx 2>/dev/null; then
      return 0
    fi
  fi
  pgrep -x nginx >/dev/null 2>&1
}

ensure_nginx_running() {
  if nginx_running; then
    return 0
  fi
  log "nginx не запущен - запускаю"
  if command -v systemctl >/dev/null 2>&1 && systemctl start nginx >/dev/null 2>&1; then
    sleep 1
    if nginx_running; then
      log "nginx запущен"
      return 0
    fi
  fi
  if nginx >/dev/null 2>&1; then
    sleep 1
    if nginx_running; then
      return 0
    fi
  fi
  warn "не удалось запустить nginx"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl status nginx --no-pager 2>&1 | tail -5 | sed 's/^/    /' >&2 || true
  fi
  hint "проверьте: nginx -t; systemctl status nginx"
  return 1
}

# Проверяет конфиг и перезагружает nginx; при ошибке печатает вывод nginx -t.
nginx_validate_reload() {
  if ! nginx -t >/dev/null 2>&1; then
    log "nginx -t не прошёл - конфиг не применён. Вывод nginx:"
    nginx -t 2>&1 | tail -15 | sed 's/^/    /' >&2 || true
    return 1
  fi
  if reload_nginx; then
    return 0
  fi
  if ensure_nginx_running && reload_nginx; then
    return 0
  fi
  log "nginx не принял reload: ${last_nginx_error:-нет вывода}"
  hint "проверьте: systemctl status nginx; nginx -t"
  return 1
}

# Кладёт готовый конфиг в файл сайта; при ошибке возвращает прежний файл.
apply_site_file() {
  local candidate="$1" backup="" had_file=0
  backup="$(mktemp "${TMPDIR:-/tmp}/bitebalance-nginx-backup.XXXXXX")" || backup=""
  if [[ -f "$NGINX_SITE_FILE" ]]; then
    had_file=1
    if [[ -n "$backup" ]] && ! cp "$NGINX_SITE_FILE" "$backup" 2>/dev/null; then
      log "не удалось прочитать $NGINX_SITE_FILE"
      rm -f "$backup"
      return 1
    fi
  fi
  if ! cp "$candidate" "$NGINX_SITE_FILE" 2>/dev/null; then
    log "не удалось записать $NGINX_SITE_FILE"
    hint "нужны права root: sudo $0"
    rm -f "$backup"
    return 1
  fi
  if ! nginx_validate_reload; then
    if ((had_file)) && [[ -n "$backup" ]]; then
      cp "$backup" "$NGINX_SITE_FILE" 2>/dev/null || true
      log "вернул прежний конфиг nginx"
    else
      rm -f "$NGINX_SITE_FILE"
    fi
    rm -f "$backup"
    return 1
  fi
  rm -f "$backup"
  return 0
}

# Собирает конфиг сайта из шаблона: подставляет домен и порт слота.
install_site_from_template() {
  local template="$1" port="$2" tmp="" rc=0
  if [[ ! -f "$template" ]]; then
    log "не найден шаблон $template"
    hint "проверьте каталог $APP_DIR/deploy/nginx"
    return 1
  fi
  if ! mkdir -p "$(dirname "$NGINX_SITE_FILE")" 2>/dev/null; then
    log "нет прав на каталог $(dirname "$NGINX_SITE_FILE")"
    hint "запустите деплой от root: sudo $0"
    return 1
  fi
  tmp="$(mktemp "${TMPDIR:-/tmp}/bitebalance-site.XXXXXX")" || return 1
  sed -e "s/food\.fastclass\.ru/$SITE_HOST/g" \
      -e "s|/etc/letsencrypt/live/|$CERTBOT_LIVE_DIR/|g" \
      -e "s|/var/www/certbot|$ACME_WEBROOT|g" \
      -e "s/127\.0\.0\.1:8080/127.0.0.1:${port}/g" "$template" > "$tmp"
  apply_site_file "$tmp" || rc=1
  rm -f "$tmp"
  return "$rc"
}

install_http_site() {
  log "nginx: ставлю HTTP-конфиг без TLS"
  install_site_from_template "$APP_DIR/deploy/nginx/food.fastclass.ru.http.conf" "$ACTIVE_PORT"
}

install_https_site() {
  log "nginx: включаю HTTPS-конфиг с сертификатом для $SITE_HOST"
  install_site_from_template "$APP_DIR/deploy/nginx/food.fastclass.ru.conf" "$ACTIVE_PORT"
}

# В SNI-режиме TLS завершает stream-слой: проверяем, что там есть наш домен.
stream_map_notice() {
  local stream_conf=""
  stream_conf="$(cfg NGINX_STREAM_CONF "")"
  if [[ -z "$stream_conf" ]]; then
    warn "NGINX_STREAM_CONF не задан - не проверить stream-map"
    return 0
  fi
  if [[ ! -f "$stream_conf" ]]; then
    warn "NGINX_STREAM_CONF=$stream_conf не существует - проверьте путь"
    return 0
  fi
  if grep -q "$SITE_HOST" "$stream_conf"; then
    log "nginx: stream-map содержит $SITE_HOST - ок"
    return 0
  fi
  warn "в $stream_conf нет строки для $SITE_HOST - добавьте:"
  warn "  $SITE_HOST 127.0.0.1:8447;   (в map) и server на listen 127.0.0.1:8447"
  return 0
}

# Если конфига сайта ещё нет (первый деплой на чистом сервере), собираем его
# из шаблона репозитория: обычный вариант, HTTP-вариант или вариант для SNI.
ensure_nginx_site() {
  local mode="" template="" tmp="" enabled=""

  mode="$(cfg NGINX_SNI 0)"
  if [[ -f "$NGINX_SITE_FILE" ]]; then
    log "nginx: конфиг уже существует: $NGINX_SITE_FILE"
    # Файл может существовать, но не быть подключён к nginx: тогда запросы
    # (и ACME-проверка) уходят в старый default-конфиг, а новый сертификат
    # просто не используется.
    enabled="/etc/nginx/sites-enabled/$(basename "$NGINX_SITE_FILE")"
    if [[ -d /etc/nginx/sites-enabled && ! -e "$enabled" ]]; then
      if ln -sfn "$NGINX_SITE_FILE" "$enabled" 2>/dev/null; then
        log "nginx: сайт включён: $enabled"
        nginx_validate_reload || warn "не удалось перезагрузить nginx после включения сайта"
      else
        warn "не удалось включить сайт: ln -sf $NGINX_SITE_FILE $enabled"
      fi
    fi
    return 0
  fi

  if [[ "$mode" == "1" ]]; then
    template="$APP_DIR/deploy/nginx/food.fastclass.ru.sni.conf"
  elif cert_present; then
    template="$APP_DIR/deploy/nginx/food.fastclass.ru.conf"
  else
    template="$APP_DIR/deploy/nginx/food.fastclass.ru.http.conf"
    log "nginx: сертификата для $SITE_HOST пока нет - начинаю с HTTP-конфига"
  fi
  if [[ ! -f "$template" ]]; then
    die "не найден шаблон $template" "проверьте каталог $APP_DIR/deploy/nginx"
  fi

  if ! mkdir -p "$(dirname "$NGINX_SITE_FILE")" 2>/dev/null; then
    die "нет прав на каталог $(dirname "$NGINX_SITE_FILE")" \
      "запустите деплой от root: sudo $0"
  fi
  log "nginx: создаю $NGINX_SITE_FILE из ${template##*/} (SNI=$mode, домен $SITE_HOST, слот :$ACTIVE_PORT)"

  tmp="$(mktemp "${TMPDIR:-/tmp}/bitebalance-site.XXXXXX")" \
    || die "не удалось создать временный файл для конфига nginx"
  if [[ "$mode" == "1" ]]; then
    # В SNI-варианте TLS завершает stream-слой общим сертификатом сервера
    # (food.fastclass.ru). Пути к сертам не трогаем, иначе nginx -t упадёт
    # на отсутствующем каталоге для нового домена.
    sed -e "/server_name/s/food\.fastclass\.ru/$SITE_HOST/g" \
        -e "/access_log/s/food\.fastclass\.ru/$SITE_HOST/g" \
        -e "/error_log/s/food\.fastclass\.ru/$SITE_HOST/g" \
        -e "s|/var/www/certbot|$ACME_WEBROOT|g" \
        -e "s/127\.0\.0\.1:8080/127.0.0.1:$ACTIVE_PORT/g" \
        "$template" > "$tmp"
  else
    sed -e "s/food\.fastclass\.ru/$SITE_HOST/g" \
        -e "s|/var/www/certbot|$ACME_WEBROOT|g" \
        -e "s/127\.0\.0\.1:8080/127.0.0.1:$ACTIVE_PORT/g" \
        "$template" > "$tmp"
  fi

  # Сайт должен быть включён до reload, иначе nginx подхватит его только
  # после следующей перезагрузки.
  enabled="/etc/nginx/sites-enabled/$(basename "$NGINX_SITE_FILE")"
  if [[ -d /etc/nginx/sites-enabled && ! -e "$enabled" ]]; then
    ln -sfn "$NGINX_SITE_FILE" "$enabled" 2>/dev/null \
      || warn "не удалось включить сайт: ln -sf $NGINX_SITE_FILE $enabled"
    if [[ -e /etc/nginx/sites-enabled/default ]]; then
      warn "в sites-enabled есть default - проверьте, что он не перехватывает $SITE_HOST"
    fi
  fi

  if ! apply_site_file "$tmp"; then
    rm -f "$tmp"
    if [[ ! -f "$NGINX_SITE_FILE" ]]; then
      rm -f "$enabled" 2>/dev/null || true
    fi
    return 1
  fi
  rm -f "$tmp"
  log "nginx: конфиг создан и активен: $NGINX_SITE_FILE"
  if [[ "$mode" == "1" ]]; then
    stream_map_notice
  fi
  return 0
}

# Меняет порт приложения в конфиге сайта и перезагружает nginx.
# При любой ошибке возвращает исходный файл.
nginx_switch() {
  local old_port="$1" new_port="$2" tmp="" backup=""
  if [[ ! -f "$NGINX_SITE_FILE" ]]; then
    log "nginx_switch: нет файла $NGINX_SITE_FILE"
    hint "конфиг сайта должен существовать до переключения трафика"
    return 1
  fi
  if ! grep -q "127\.0\.0\.1:${old_port}" "$NGINX_SITE_FILE"; then
    # Повторный вызов после частичного сбоя: порт уже переключён.
    if grep -q "127\.0\.0\.1:${new_port}" "$NGINX_SITE_FILE"; then
      log "nginx_switch: конфиг уже указывает на порт $new_port"
      return 0
    fi
    log "nginx_switch: в $NGINX_SITE_FILE нет 127.0.0.1:$old_port - нечего менять"
    log "nginx_switch: строки конфига:"
    grep -nE 'proxy_pass|listen|ssl_certificate|server_name' "$NGINX_SITE_FILE" 2>/dev/null \
      | head -12 | sed 's/^/    /' >&2 || true
    hint "проверьте, что в конфиге сайта есть proxy_pass http://127.0.0.1:$old_port"
    return 1
  fi

  tmp="$(mktemp "${TMPDIR:-/tmp}/bitebalance-nginx.XXXXXX")" || return 1
  backup="$(mktemp "${TMPDIR:-/tmp}/bitebalance-nginx-backup.XXXXXX")" || { rm -f "$tmp"; return 1; }
  if ! cp "$NGINX_SITE_FILE" "$backup" 2>/dev/null; then
    log "nginx_switch: не удалось прочитать $NGINX_SITE_FILE"
    rm -f "$tmp" "$backup"
    return 1
  fi
  sed "s/127\.0\.0\.1:${old_port}\([^0-9]\)/127.0.0.1:${new_port}\1/g" "$NGINX_SITE_FILE" > "$tmp"
  if ! grep -q "127\.0\.0\.1:${new_port}" "$tmp"; then
    log "nginx_switch: замена порта не сработала"
    hint "проверьте формат proxy_pass в $NGINX_SITE_FILE"
    rm -f "$tmp" "$backup"
    return 1
  fi
  if ! cp "$tmp" "$NGINX_SITE_FILE" 2>/dev/null; then
    log "nginx_switch: нет прав записать $NGINX_SITE_FILE"
    hint "запустите деплой от root: sudo $0"
    rm -f "$tmp" "$backup"
    return 1
  fi
  if ! nginx -t >/dev/null 2>&1; then
    log "nginx_switch: nginx -t не прошёл с портом ${new_port}, вывод:"
    nginx -t 2>&1 | tail -10 | sed 's/^/    /' >&2 || true
    cp "$backup" "$NGINX_SITE_FILE" 2>/dev/null || true
    rm -f "$tmp" "$backup"
    return 1
  fi
  if ! reload_nginx; then
    if ensure_nginx_running && reload_nginx; then
      rm -f "$tmp" "$backup"
      return 0
    fi
    log "nginx_switch: не удалось перезагрузить nginx: ${last_nginx_error:-нет вывода}"
    cp "$backup" "$NGINX_SITE_FILE" 2>/dev/null || true
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
  if [[ -n "$port" && "$port" != "$BLUE_PORT" && "$port" != "$GREEN_PORT" ]]; then
    warn "в $NGINX_SITE_FILE нестандартный порт $port - ожидал $BLUE_PORT или $GREEN_PORT"
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
  mkdir -p "$(dirname "$SLOT_FILE")" 2>/dev/null || return 1
  {
    printf 'SLOT=%s\n' "$CAND_SLOT"
    printf 'PORT=%s\n' "$CAND_PORT"
    printf 'RELEASE=%s\n' "${GIT_SHA:-unknown}"
    printf 'UPDATED=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  } > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }
  mv -f "$tmp" "$SLOT_FILE" 2>/dev/null || { rm -f "$tmp"; return 1; }
  return 0
}

# --- SSL / Let's Encrypt ---

cert_present() { [[ -s "$CERT_FILE" && -s "$KEY_FILE" ]]; }

cert_checks_possible() { command -v openssl >/dev/null 2>&1; }

cert_expiry() {
  local end=""
  if ! cert_checks_possible; then
    printf 'неизвестно'
    return 0
  fi
  end="$(openssl x509 -in "$CERT_FILE" -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
  printf '%s' "${end:-неизвестно}"
}

# Сертификат действителен ещё хотя бы N дней? Без openssl считаем, что да:
# лучше не перевыпускать сертификат вслепую.
cert_valid_for() {
  local days="$1"
  cert_checks_possible || return 0
  openssl x509 -in "$CERT_FILE" -checkend "$((days * 86400))" -noout >/dev/null 2>&1
}

# Выписан ли сертификат на наш домен? Файл может существовать, но быть чужим -
# именно так на сайте оказывается сертификат другого домена.
cert_covers_host() {
  cert_checks_possible || return 0
  # OpenSSL 1.1.1+ проверяет SAN/CN сам (с учётом wildcard).
  if openssl x509 -in "$CERT_FILE" -noout -checkhost "$SITE_HOST" >/dev/null 2>&1; then
    return 0
  fi
  # LibreSSL и старые openssl не знают -checkhost: разбираем текст сертификата.
  local text="" host_re=""
  text="$(openssl x509 -in "$CERT_FILE" -noout -text 2>/dev/null || true)"
  host_re="${SITE_HOST//./\\.}"
  if printf '%s' "$text" | grep -Eqi "(DNS|CN)[^A-Za-z0-9.-]*$host_re([^A-Za-z0-9.-]|$)"; then
    return 0
  fi
  return 1
}

site_config_has_ssl() {
  [[ -f "$NGINX_SITE_FILE" ]] \
    && grep -qE '^[[:space:]]*ssl_certificate[[:space:]]' "$NGINX_SITE_FILE" 2>/dev/null
}

certbot_renewal_enabled() {
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-enabled --quiet certbot.timer 2>/dev/null; then
      return 0
    fi
    if systemctl is-active --quiet certbot.timer 2>/dev/null; then
      return 0
    fi
    return 1
  fi
  return 0
}

ensure_acme_webroot() {
  if [[ -d "$ACME_WEBROOT" ]]; then
    return 0
  fi
  if ! mkdir -p "$ACME_WEBROOT" 2>/dev/null; then
    log "SSL: нет прав создать $ACME_WEBROOT"
    hint "создайте каталог: sudo mkdir -p $ACME_WEBROOT"
    return 1
  fi
  chmod 755 "$ACME_WEBROOT" 2>/dev/null || true
  return 0
}

# Каталог, из которого nginx реально отдаёт ACME-файлы.
acme_webroot_from_config() {
  local root=""
  root="$(grep -A3 'acme-challenge' "$NGINX_SITE_FILE" 2>/dev/null \
    | grep -oE 'root[[:space:]]+[^;]+' | head -1 | awk '{print $2}' | tr -d ';' || true)"
  printf '%s' "$root"
}

# Проверяем то, что проверит Let's Encrypt: HTTP-порт 80 и ACME-путь.
acme_preflight() {
  local code="" cfg_root=""
  if ! grep -q 'acme-challenge' "$NGINX_SITE_FILE" 2>/dev/null; then
    log "SSL: в $NGINX_SITE_FILE нет location /.well-known/acme-challenge/"
    hint "добавьте в server-блок на порту 80: location /.well-known/acme-challenge/ { root $ACME_WEBROOT; }"
    return 1
  fi
  # certbot должен писать туда же, откуда nginx читает: иначе проверка даст 404.
  cfg_root="$(acme_webroot_from_config || true)"
  if [[ -n "$cfg_root" && "$cfg_root" != "$ACME_WEBROOT" ]]; then
    log "SSL: nginx отдаёт ACME из $cfg_root - использую этот каталог"
    ACME_WEBROOT="$cfg_root"
  fi
  ensure_acme_webroot || return 1
  ensure_nginx_running || return 1

  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
    "http://127.0.0.1/.well-known/acme-challenge/bitebalance-probe" 2>/dev/null || true)"
  if [[ ! "$code" =~ ^[0-9]{3}$ ]]; then
    log "SSL: локальный nginx не отвечает на порту 80 (${code:-нет ответа})"
    hint "проверьте: curl -i http://127.0.0.1/ ; systemctl status nginx"
    return 1
  fi

  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 \
    "http://$SITE_HOST/.well-known/acme-challenge/bitebalance-probe" 2>/dev/null || true)"
  if [[ ! "$code" =~ ^[0-9]{3}$ ]]; then
    log "SSL: снаружи http://$SITE_HOST не отвечает (${code:-нет ответа})"
    hint "проверьте DNS: dig +short $SITE_HOST; и фаервол: ufw allow 80/tcp"
    hint "выпуск всё равно попробую - Let's Encrypt ходит снаружи"
  elif [[ "$code" != "404" && "$code" != "403" ]]; then
    log "SSL: неожиданный код $code на ACME-путь - возможно, домен обслуживает другой сервер"
    hint "проверьте, что $SITE_HOST указывает именно на этот сервер"
  fi
  return 0
}

# Объясняет частые ошибки certbot по его выводу.
certbot_explain() {
  local logf="$1"
  if grep -qi 'too many.*certificates\|rate limit\|too many failed authorizations' "$logf" 2>/dev/null; then
    hint "Let's Encrypt ограничил выпуск (лимит) - повторите позже или проверку через LE_STAGING=1"
  elif grep -qi 'no valid ip addresses\|nxdomain\|dns problem\|servfail' "$logf" 2>/dev/null; then
    hint "DNS: $SITE_HOST не указывает на этот сервер - проверьте A-запись: dig +short $SITE_HOST"
  elif grep -qi 'timeout during connect\|connection timed out' "$logf" 2>/dev/null; then
    hint "порт 80 снаружи недоступен: откройте его в фаерволе (ufw allow 80/tcp) и проверьте NAT"
  elif grep -qi 'invalid response\|unauthorized\|404' "$logf" 2>/dev/null; then
    hint "ACME-проверка не нашла файл: проверьте location /.well-known/acme-challenge/ и root $ACME_WEBROOT"
  elif grep -qi 'command not found' "$logf" 2>/dev/null; then
    hint "certbot не установлен: apt install -y certbot"
  fi
  return 0
}

# Пробует выпустить сертификат. Возвращает 0, если файлы сертификата появились.
issue_certificate() {
  local -a certbot_args
  local certbot_log="" rc=0

  if ! command -v certbot >/dev/null 2>&1; then
    if [[ "${AUTO_SSL_INSTALL:-0}" == "1" ]] && command -v apt-get >/dev/null 2>&1; then
      log "SSL: certbot не установлен - устанавливаю (AUTO_SSL_INSTALL=1)"
      DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || true
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot >/dev/null 2>&1 \
        || log "SSL: установка certbot не удалась"
    fi
  fi
  if ! command -v certbot >/dev/null 2>&1; then
    log "SSL: certbot не установлен - автоматический выпуск невозможен"
    hint "apt install -y certbot (или задайте AUTO_SSL_INSTALL=1)"
    return 1
  fi

  if ! acme_preflight; then
    hint "проверка ACME не пройдена - выпуск не запускаю"
    return 1
  fi

  certbot_args=(certonly --webroot -w "$ACME_WEBROOT" -d "$SITE_HOST" \
    --cert-name "$SITE_HOST" --non-interactive --agree-tos --keep-until-expiring)
  if [[ -n "$LE_EMAIL" ]]; then
    certbot_args+=(-m "$LE_EMAIL")
  else
    log "SSL: LE_EMAIL не задан - регистрируюсь без e-mail (уведомления об истечении не придут)"
    certbot_args+=(--register-unsafely-without-email)
  fi
  if [[ "${LE_STAGING:-0}" == "1" ]]; then
    certbot_args+=(--staging)
    log "SSL: LE_STAGING=1 - беру тестовый сертификат Let's Encrypt"
  fi

  certbot_log="$(mktemp "${TMPDIR:-/tmp}/bitebalance-certbot.XXXXXX")" || return 1
  log "SSL: запускаю certbot для $SITE_HOST (webroot $ACME_WEBROOT)"
  trap - ERR
  set +e
  certbot "${certbot_args[@]}" >"$certbot_log" 2>&1
  rc=$?
  set -e
  trap on_error ERR
  if ((rc != 0)); then
    log "SSL: certbot завершился с кодом $rc, последние строки:"
    tail -n 20 "$certbot_log" | sed 's/^/    /' >&2 || true
    certbot_explain "$certbot_log"
    hint "полный вывод certbot: $certbot_log"
    return 1
  fi
  if ! cert_present; then
    log "SSL: certbot отработал, но файла $CERT_FILE нет"
    tail -n 10 "$certbot_log" | sed 's/^/    /' >&2 || true
    return 1
  fi
  return 0
}

# Главная проверка TLS: есть ли сертификат, нужен ли он, и что делать.
ensure_ssl() {
  local renew_days="$CERT_RENEW_DAYS"
  local cert_ok=0

  if [[ "$SITE_HOST" =~ ^[0-9.]+$ ]]; then
    log "SSL: SITE_URL указывает на IP ($SITE_HOST) - Let's Encrypt для IP сертификаты не выпускает"
    return 0
  fi
  if [[ "$NGINX_SNI" == "1" ]]; then
    log "SSL: SNI-режим - TLS завершает stream-слой, выпуском сертификата скрипт не занимается"
    # В SNI-варианте сайт использует общий сертификат сервера: проверяем именно
    # тот путь, что указан в конфиге, а не каталог для $SITE_HOST.
    local sni_cert=""
    if [[ -f "$NGINX_SITE_FILE" ]]; then
      sni_cert="$(grep -m1 -E '^[[:space:]]*ssl_certificate[[:space:]]' "$NGINX_SITE_FILE" 2>/dev/null \
        | awk '{print $2}' | tr -d ';' || true)"
    fi
    if [[ -n "$sni_cert" && -s "$sni_cert" ]]; then
      log "SSL: общий сертификат на месте: $sni_cert"
    elif [[ -n "$sni_cert" ]]; then
      warn "SSL: файл общего сертификата не найден: $sni_cert"
      hint "проверьте сертификат stream-слоя и путь ssl_certificate в $NGINX_SITE_FILE"
    else
      log "SSL: в $NGINX_SITE_FILE не указан ssl_certificate - TLS настраивается на stream-слое"
    fi
    return 0
  fi
  if ((AUTO_SSL == 0)); then
    log "SSL: авто-выпуск отключён (--no-ssl)"
    return 0
  fi

  if cert_present; then
    if ! cert_covers_host; then
      warn "SSL: сертификат $CERT_FILE выписан не на $SITE_HOST - перевыпускаю"
      hint "проверьте домен: SITE_URL в .env должен указывать на настоящий сайт"
    elif cert_valid_for "$renew_days"; then
      cert_ok=1
    fi
  fi

  if ((cert_ok)); then
    log "SSL: сертификат $SITE_HOST на месте, действует до $(cert_expiry)"
    if ! site_config_has_ssl; then
      log "SSL: в конфиге nginx нет HTTPS - включаю"
      install_https_site || warn "не удалось включить HTTPS-конфиг - сайт останется по HTTP"
    fi
    return 0
  fi

  if ((CHECK)); then
    if cert_present && ! cert_covers_host; then
      log "SSL: сертификат $CERT_FILE выписан не на $SITE_HOST - при деплое скрипт перевыпустит его"
    elif cert_present; then
      log "SSL: сертификат $SITE_HOST истекает $(cert_expiry) - при деплое скрипт попробует продлить"
    else
      log "SSL: сертификата $SITE_HOST нет - при деплое скрипт попробует выпустить (certbot)"
    fi
    if ! command -v certbot >/dev/null 2>&1; then
      warn "certbot не установлен - авто-выпуск не сработает (apt install -y certbot)"
    fi
    return 0
  fi

  if cert_present && cert_covers_host; then
    log "SSL: сертификат истекает $(cert_expiry) - продлеваю через certbot renew"
    if command -v certbot >/dev/null 2>&1; then
      if certbot renew --cert-name "$SITE_HOST" --quiet; then
        log "SSL: сертификат продлён, действует до $(cert_expiry)"
      else
        warn "certbot renew не удался"
        hint "проверьте: certbot renew --cert-name $SITE_HOST --dry-run"
      fi
    else
      warn "certbot не установлен - продлить нечем"
    fi
    if cert_present && cert_valid_for 1; then
      if ! site_config_has_ssl; then
        install_https_site || warn "не удалось включить HTTPS-конфиг"
      fi
      return 0
    fi
    log "SSL: сертификат всё ещё невалиден - пробую выпустить заново"
  fi

  # Просроченный сертификат ломает nginx - сначала поднимаем сайт по HTTP.
  if cert_present && ! cert_valid_for 1 && site_config_has_ssl; then
    log "SSL: сертификат просрочен - временно переключаю сайт на HTTP"
    install_http_site || warn "не удалось переключить сайт на HTTP"
  fi
  if site_config_has_ssl && ! cert_present; then
    log "SSL: конфиг ссылается на отсутствующий сертификат - временно ставлю HTTP-конфиг"
    if ! install_http_site; then
      warn "не удалось поставить HTTP-конфиг - nginx может не запуститься"
      return 0
    fi
  fi

  log "SSL: пробую выпустить сертификат для $SITE_HOST через Let's Encrypt"
  if issue_certificate; then
    log "SSL: сертификат выпущен: $CERT_FILE"
    if install_https_site; then
      log "SSL: HTTPS включён, сертификат действует до $(cert_expiry)"
      if ! certbot_renewal_enabled; then
        warn "автопродление certbot не включено - после истечения HTTPS перестанет работать"
        hint "systemctl enable --now certbot.timer"
      fi
    else
      warn "сертификат есть, но HTTPS-конфиг не включился - сайт работает по HTTP"
      hint "проверьте $NGINX_SITE_FILE и вывод nginx -t"
    fi
  else
    warn "выпустить сертификат не удалось - сайт продолжит работать по HTTP"
    hint "устраните причину и повторите деплой (или: certbot certonly --webroot -w $ACME_WEBROOT -d $SITE_HOST)"
  fi
  return 0
}

# --- Диагностика и откат ---

# Общая диагностика окружения: печатает только реально найденные проблемы.
diagnose_failure() {
  local containers="" use="" avail=""
  if command -v docker >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then
      containers="$(docker compose ps --format '{{.Name}} {{.Status}}' 2>/dev/null | tr '\n' ';' || true)"
      if [[ -n "$containers" ]]; then
        hint "контейнеры проекта: ${containers%;}"
      fi
    else
      hint "Docker-демон недоступен: systemctl start docker; права: usermod -aG docker \$USER"
    fi
  fi
  use="$(df -P "$APP_DIR" 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}' || true)"
  avail="$(df -Ph "$APP_DIR" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
  if [[ "$use" =~ ^[0-9]+$ ]] && ((use >= 90)); then
    hint "на диске занято ${use}% (свободно ${avail:-?}): docker system prune -af"
  fi
  if [[ "$SITE_URL" == https://* ]] && ! cert_present; then
    hint "HTTPS не заработает без сертификата: смотрите раздел SSL выше и docs/DEPLOY.md"
  fi
  if [[ -n "$DEPLOY_LOG" ]]; then
    hint "полный лог деплоя: $DEPLOY_LOG"
  fi
  return 0
}

# Возвращает рабочую конфигурацию: nginx на старый слот, кандидат погашен.
rollback_on_failure() {
  if ((DEPLOY_DONE)); then
    return 0
  fi
  if ((SWITCHED)); then
    log "откат: возвращаю nginx на порт $ACTIVE_PORT"
    if nginx_switch "$CAND_PORT" "$ACTIVE_PORT"; then
      SWITCHED=0
    else
      warn "не удалось вернуть nginx на :$ACTIVE_PORT - проверьте $NGINX_SITE_FILE"
    fi
  fi
  if ((CAND_STARTED)); then
    log "откат: останавливаю app-$CAND_SLOT"
    docker compose stop "app-$CAND_SLOT" >/dev/null 2>&1 || true
    CAND_STARTED=0
  fi
  return 0
}

on_error() {
  local code=$? cmd="${BASH_COMMAND:-?}" line="${BASH_LINENO[0]:-?}"
  trap - ERR
  set +e
  error_block "деплой прерван на строке $line (код $code)" \
    "команда: $cmd" \
    "файл: ${BASH_SOURCE[0]}"
  diagnose_failure
  rollback_on_failure
  exit "$code"
}
trap on_error ERR

# Все сообщения деплоя дублируются в файл: по нему видно, что именно упало.
setup_deploy_log() {
  local dir="$APP_DIR/.runtime/deploy/logs"
  mkdir -p "$dir" 2>/dev/null || return 0
  DEPLOY_LOG="$dir/deploy-$(date '+%Y%m%d-%H%M%S').log"
  if ! : >"$DEPLOY_LOG" 2>/dev/null; then
    DEPLOY_LOG=""
    return 0
  fi
  ln -sfn "$DEPLOY_LOG" "$dir/latest" 2>/dev/null || true
  return 0
}

# Путь (или ближайший существующий родитель) доступен на запись?
writable_path() {
  local p="$1"
  while [[ ! -e "$p" && "$p" != "/" ]]; do
    p="$(dirname "$p")"
  done
  [[ -w "$p" ]]
}

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    if ss -Hltn "sport = :${port}" 2>/dev/null | grep -q .; then
      return 0
    fi
  elif command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
  fi
  return 1
}

port_owner() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -Hltnp "sport = :${port}" 2>/dev/null | head -1
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1" (pid "$2")"}'
  fi
}

show_logs() {
  local service="$1" lines="${2:-60}"
  docker compose logs --tail "$lines" "$service" 2>&1 | sed 's/^/    /' >&2 || true
}

ensure_db() {
  local i db_id db_state=""
  log "проверяем базу"
  run_step "запускаем db" \
    "смотрите: docker compose logs --tail 60 db; свободное место; пароль POSTGRES_PASSWORD" \
    docker compose up -d --no-deps db
  for ((i = 1; i <= 60; i++)); do
    db_id="$(docker compose ps -q db 2>/dev/null || true)"
    if [[ -n "$db_id" ]]; then
      db_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_id" 2>/dev/null || true)"
    fi
    if [[ "$db_state" == "healthy" || "$db_state" == "running" ]]; then
      return 0
    fi
    sleep 2
  done
  show_logs db 40
  die "база не поднялась за 120 с (состояние: ${db_state:-неизвестно})" \
    "смотрите вывод выше и: docker compose logs -f db" \
    "частые причины: занятый том, нехватка места, неверный POSTGRES_PASSWORD"
}

# ---------- Проверки ----------

[[ -f "$ENV_FILE" ]] || die "не найден $ENV_FILE" \
  "скопируйте пример: cp $APP_DIR/.env.example $ENV_FILE" \
  "затем заполните SITE_URL и пароли"

SITE_URL="$(cfg SITE_URL "")"
SITE_URL="${SITE_URL%/}"
if [[ -z "$SITE_URL" ]]; then
  die "SITE_URL не задан" \
    "добавьте в $ENV_FILE строку SITE_URL=https://ваш-домен"
fi
if [[ ! "$SITE_URL" =~ ^https?://([A-Za-z0-9.-]+)(:[0-9]{1,5})?$ ]]; then
  die "SITE_URL должен быть вида https://example.com без пути" \
    "сейчас: $SITE_URL"
fi
SITE_HOST="$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"
SITE_SCHEME="${SITE_URL%%://*}"

BLUE_PORT="$(cfg APP_PORT 8080)"
GREEN_PORT="$(cfg APP_PORT_GREEN 8081)"
APP_BIND="$(cfg APP_BIND 127.0.0.1)"
if [[ ! "$BLUE_PORT" =~ ^[0-9]+$ || ! "$GREEN_PORT" =~ ^[0-9]+$ ]]; then
  die "APP_PORT и APP_PORT_GREEN должны быть числами" \
    "сейчас: APP_PORT=$BLUE_PORT, APP_PORT_GREEN=$GREEN_PORT"
fi
if [[ "$BLUE_PORT" == "$GREEN_PORT" ]]; then
  die "APP_PORT и APP_PORT_GREEN не должны совпадать (оба $BLUE_PORT)" \
    "слоты blue и green должны слушать разные порты"
fi
HEALTH_HOST="$APP_BIND"
if [[ -z "$HEALTH_HOST" || "$HEALTH_HOST" == "0.0.0.0" ]]; then
  HEALTH_HOST="127.0.0.1"
fi

NGINX_SITE_FILE="$(cfg NGINX_SITE_FILE "/etc/nginx/sites-available/$SITE_HOST")"
NGINX_SNI="$(cfg NGINX_SNI 0)"
NGINX_STREAM_CONF="$(cfg NGINX_STREAM_CONF "")"

CERTBOT_LIVE_DIR="$(cfg CERTBOT_LIVE_DIR "/etc/letsencrypt/live")"
CERT_DIR="$CERTBOT_LIVE_DIR/$SITE_HOST"
CERT_FILE="$CERT_DIR/fullchain.pem"
KEY_FILE="$CERT_DIR/privkey.pem"
ACME_WEBROOT="$(cfg ACME_WEBROOT "/var/www/certbot")"
LE_EMAIL="$(cfg LE_EMAIL "")"
CERT_RENEW_DAYS="$(cfg CERT_RENEW_DAYS 30)"
[[ "$CERT_RENEW_DAYS" =~ ^[0-9]+$ ]] || CERT_RENEW_DAYS=30

AUTO_SSL="$(cfg AUTO_SSL 1)"
[[ "$AUTO_SSL" =~ ^[01]$ ]] || AUTO_SSL=1
if ((NO_SSL)); then
  AUTO_SSL=0
fi

POSTGRES_USER="$(cfg POSTGRES_USER bitebalance)"
POSTGRES_DB="$(cfg POSTGRES_DB bitebalance)"

for cmd in docker curl gzip; do
  command -v "$cmd" >/dev/null 2>&1 || die "не найдена команда: $cmd" \
    "установите её: apt install -y docker.io curl gzip"
done
command -v tee >/dev/null 2>&1 || die "не найдена команда: tee" \
  "установите coreutils: apt install -y coreutils"

if ! docker info >/dev/null 2>&1; then
  if ((CHECK)); then
    warn "Docker-демон недоступен - полная проверка невозможна"
    hint "запустите: systemctl start docker"
  else
    die "Docker-демон недоступен" \
      "запустите его: systemctl start docker" \
      "права на сокет: usermod -aG docker \$USER и перелогин"
  fi
fi
if command -v docker >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
  die "нужен Docker Compose v2 (команда docker compose)" \
    "проверьте: docker compose version" \
    "Ubuntu/Debian: apt install -y docker-compose-v2"
fi

if ((PULL)); then
  command -v git >/dev/null 2>&1 || die "не найдена команда: git" \
    "установите git или запустите с --no-pull"
fi

if ! command -v nginx >/dev/null 2>&1; then
  if ((CHECK)); then
    warn "nginx не найден - переключать трафик нечем (apt install -y nginx)"
  else
    die "не найден nginx" "установите: apt install -y nginx"
  fi
fi

# Права на конфиг сайта проверяем сразу: иначе деплой упадёт уже после сборки.
if [[ -f "$NGINX_SITE_FILE" ]]; then
  if [[ ! -w "$NGINX_SITE_FILE" ]]; then
    if ((CHECK)); then
      warn "нет прав на запись $NGINX_SITE_FILE - деплой потребует root"
    else
      die "нет прав на запись $NGINX_SITE_FILE" "запустите деплой от root: sudo $0"
    fi
  fi
elif ! writable_path "$(dirname "$NGINX_SITE_FILE")"; then
  if ((CHECK)); then
    warn "нет прав создать $NGINX_SITE_FILE - деплой потребует root"
  else
    die "нет прав создать $NGINX_SITE_FILE" \
      "запустите деплой от root: sudo $0" \
      "проверьте путь NGINX_SITE_FILE в $ENV_FILE"
  fi
fi

if [[ "$SITE_SCHEME" == "http" ]] && ((AUTO_SSL)); then
  warn "SITE_URL начинается с http:// - после выпуска сертификата поменяйте на https://"
fi

if [[ "$NGINX_SNI" != "1" && -f "$NGINX_SITE_FILE" ]] \
  && grep -qE 'proxy_protocol|ssl_preread' "$NGINX_SITE_FILE" 2>/dev/null; then
  warn "конфиг $NGINX_SITE_FILE похож на SNI-вариант, но NGINX_SNI не задан"
  hint "если TLS завершает stream-слой, задайте NGINX_SNI=1 в .env"
fi

[[ -n "$(dotenv_value YANDEX_CLIENT_ID || true)" && -n "$(dotenv_value YANDEX_CLIENT_SECRET || true)" ]] \
  || warn "YANDEX_CLIENT_ID/SECRET пусты - войти на сайт не получится"

# Переход со старого стека: его Postgres держит тот же том, а второй экземпляр
# на одном каталоге данных повредит базу.
legacy_running=""
for legacy in easyfood-db easyfood-app easyfood-maintenance; do
  if [[ -n "$(docker ps -q --filter "name=^/${legacy}$" 2>/dev/null || true)" ]]; then
    legacy_running="${legacy_running:+${legacy_running}, }$legacy"
  fi
done
if [[ -n "$legacy_running" ]]; then
  if ((CHECK)); then
    warn "запущен старый стек ($legacy_running) - перед деплоем его нужно остановить"
  else
    die "запущен старый стек ($legacy_running)" \
      "остановите его: cd /opt/EasyFood && docker compose down"
  fi
fi

if ((CHECK)); then
  log "проверка пройдена: SITE_URL=$SITE_URL, слоты blue=:$BLUE_PORT green=:$GREEN_PORT, база=$POSTGRES_DB"
  log "nginx: $NGINX_SITE_FILE (SNI=$NGINX_SNI)"
  if cert_present && cert_covers_host; then
    log "SSL: сертификат $SITE_HOST есть, действует до $(cert_expiry)"
  elif cert_present; then
    log "SSL: сертификат есть, но выписан не на $SITE_HOST - при деплое скрипт перевыпустит его"
  elif [[ "$NGINX_SNI" == "1" ]]; then
    log "SSL: SNI-режим - TLS обслуживает stream-слой, отдельный сертификат не выпускается"
  else
    log "SSL: сертификата $SITE_HOST нет - при деплое скрипт попробует выпустить (certbot)"
  fi
  if ! command -v certbot >/dev/null 2>&1; then
    warn "certbot не установлен - авто-выпуск сертификата не сработает"
  fi
  log "режим --check: ничего не меняю"
  exit 0
fi

# Один деплой за раз: параллельный запуск подменит слот под работающим.
# Режим --check выходит выше и блокировку не трогает.
LOCK_FILE="$APP_DIR/.runtime/deploy.lock"
mkdir -p "$(dirname "$LOCK_FILE")"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "деплой уже запущен" "файл блокировки: $LOCK_FILE" \
    "дождитесь завершения другого деплоя"
fi

setup_deploy_log

# ---------- Код ----------

if ((PULL)); then
  if [[ ! -d "$APP_DIR/.git" ]]; then
    die "$APP_DIR не git-репозиторий" "запустите с --no-pull, чтобы выложить текущий код"
  fi
  dirty="$(git status --porcelain)"
  if [[ -n "$dirty" ]]; then
    die "в рабочем дереве есть незакоммиченные изменения" \
      "закоммитьте их или запустите с --no-pull" \
      "изменено: $(printf '%s' "$dirty" | head -5 | tr '\n' ' ')"
  fi
  log "обновляем код из git"
  run_step "git fetch" \
    "проверьте доступ к origin: git remote -v; SSH-ключ и сеть" \
    git fetch --quiet --prune
  run_step "git pull --ff-only" \
    "ветка разошлась с origin - проверьте git status; либо запустите с --no-pull" \
    git pull --ff-only --quiet
fi
GIT_SHA="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || true)"

# ---------- nginx и TLS ----------

detect_active
log "активный слот: $ACTIVE_SLOT (:$ACTIVE_PORT), кандидат: $CAND_SLOT (:$CAND_PORT)"

if ! ensure_nginx_site; then
  die "не удалось подготовить конфиг nginx $NGINX_SITE_FILE" \
    "деплой остановлен до сборки, чтобы не менять работающий сайт" \
    "проверьте права и синтаксис: nginx -t"
fi
ensure_ssl

# ---------- База и бэкап ----------

ensure_db

if ((BACKUP)); then
  backup_dir="$APP_DIR/data/backups"
  mkdir -p "$backup_dir" || die "не удалось создать $backup_dir" "проверьте права на $APP_DIR"
  backup_file="$backup_dir/predeploy-$(date '+%Y%m%d-%H%M%S').sql.gz"
  log "бэкап базы перед миграциями"
  trap - ERR
  set +e
  docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --clean --if-exists --no-owner | gzip > "$backup_file"
  pg_rc=("${PIPESTATUS[@]}")
  set -e
  trap on_error ERR
  if ((pg_rc[0] != 0)) || ((pg_rc[1] != 0)); then
    rm -f "$backup_file"
    die "бэкап базы не удался (pg_dump=${pg_rc[0]}, gzip=${pg_rc[1]})" \
      "проверьте контейнер: docker compose logs --tail 40 db" \
      "пользователь: $POSTGRES_USER, база: $POSTGRES_DB" \
      "пропустить бэкап можно флагом --no-backup (не рекомендуется)"
  fi
  if [[ ! -s "$backup_file" ]]; then
    rm -f "$backup_file"
    die "бэкап базы получился пустым" \
      "проверьте: docker compose exec -T db pg_dump -U $POSTGRES_USER -d $POSTGRES_DB | head"
  fi
  log "бэкап: $backup_file ($(du -h "$backup_file" 2>/dev/null | cut -f1 || true))"
fi

# ---------- Сборка ----------

run_step "собираем образ $IMAGE" \
  "исправьте ошибку сборки выше (Dockerfile/зависимости); при нехватке места: docker system prune -af" \
  docker compose build app-blue
if [[ -n "$GIT_SHA" ]]; then
  if ! docker tag "$IMAGE:latest" "$IMAGE:$GIT_SHA" 2>/dev/null; then
    warn "не удалось пометить образ тегом $GIT_SHA (не критично)"
  else
    log "образ помечен тегом $GIT_SHA"
  fi
fi

# ---------- Кандидат ----------

if port_in_use "$CAND_PORT"; then
  owner="$(port_owner "$CAND_PORT" || true)"
  case "$owner" in
    *docker*|*Docker*|*com.docker*)
      log "порт $CAND_PORT занят докером - compose пересоздаст контейнер" ;;
    *)
      die "порт $CAND_PORT уже занят другим процессом" \
        "владелец: ${owner:-неизвестен}" \
        "освободите порт или задайте другой APP_PORT_GREEN/APP_PORT в $ENV_FILE" ;;
  esac
fi

log "поднимаем кандидата app-$CAND_SLOT"
CAND_STARTED=1
run_step "docker compose up app-$CAND_SLOT" \
  "проверьте: docker compose ps -a; docker compose logs --tail 60 app-$CAND_SLOT" \
  docker compose up -d --no-deps --force-recreate --no-build "app-$CAND_SLOT"

cand_id="$(docker compose ps -q "app-$CAND_SLOT" 2>/dev/null || true)"
if [[ -z "$cand_id" ]]; then
  die "контейнер app-$CAND_SLOT не создан" \
    "проверьте: docker compose ps -a; docker compose up --no-deps app-$CAND_SLOT"
fi
cand_status="$(docker inspect --format '{{.State.Status}}' "$cand_id" 2>/dev/null || true)"
if [[ "$cand_status" == "exited" || "$cand_status" == "dead" ]]; then
  show_logs "app-$CAND_SLOT" 40
  die "контейнер app-$CAND_SLOT упал сразу после запуска (статус: $cand_status)" \
    "смотрите логи выше; частая причина - занятый порт $CAND_PORT или неверный DATABASE_URL"
fi

log "ждём healthcheck кандидата: http://$HEALTH_HOST:$CAND_PORT/api/health"
if ! wait_http "http://$HEALTH_HOST:$CAND_PORT/api/health" 60 2; then
  show_logs "app-$CAND_SLOT" 60
  die "кандидат app-$CAND_SLOT не прошёл healthcheck" \
    "смотрите логи выше; старый слот app-$ACTIVE_SLOT продолжает работать" \
    "проверьте вручную: docker compose exec app-$CAND_SLOT wget -qO- http://127.0.0.1:3000/api/health"
fi
log "кандидат отвечает"

# ---------- Переключение трафика ----------

log "переключаем nginx на порт $CAND_PORT"
if ! nginx_switch "$ACTIVE_PORT" "$CAND_PORT"; then
  log "состояние конфига $NGINX_SITE_FILE:"
  grep -nE "listen|proxy_pass|ssl_certificate|server_name" "$NGINX_SITE_FILE" 2>/dev/null \
    | sed "s/^/    /" >&2 || true
  die "не удалось переключить nginx на порт $CAND_PORT" \
    "старый слот app-$ACTIVE_SLOT продолжает работать, кандидат остановлен" \
    "проверьте вывод nginx -t выше и конфиг $NGINX_SITE_FILE"
fi
SWITCHED=1

if ! wait_http "$SITE_URL/api/health" 10 1; then
  # Локальный healthcheck уже прошёл: кандидат жив. Если публичный адрес не
  # отвечает, дело обычно вне приложения - DNS, TLS, фаервол. Откатывать
  # рабочее приложение из-за этого нельзя.
  warn "$SITE_URL/api/health не ответил - проверьте DNS, TLS и фаервол"
  warn "деплой продолжен, nginx переключён на порт $CAND_PORT"
  if [[ "$SITE_URL" == https://* ]] && ! cert_present; then
    hint "у сайта нет сертификата - HTTPS не заработает, пока сертификат не выпущен"
  fi
else
  log "публичный адрес отвечает: $SITE_URL"
fi

# ---------- Вывод старого слота ----------

log "гасим старый слот app-$ACTIVE_SLOT"
docker compose stop "app-$ACTIVE_SLOT" >/dev/null 2>&1 || true
# Контейнер из версии без слотов: после переключения он больше не нужен.
docker rm -f bitebalance-app >/dev/null 2>&1 || true

if ! docker compose up -d --no-deps --force-recreate --no-build maintenance >/dev/null 2>&1; then
  warn "не удалось обновить maintenance"
  hint "перезапустите вручную: docker compose up -d --force-recreate maintenance"
fi

if ! write_state; then
  warn "не удалось записать $SLOT_FILE (деплой завершён, состояние не сохранено)"
fi
DEPLOY_DONE=1

# ---------- Уборка ----------

if ((PRUNE)); then
  if ! docker image prune -f >/dev/null 2>&1; then
    warn "не удалось почистить неиспользуемые образы (не критично)"
  fi
  # Оставляем три последних релизных тега, остальные удаляем.
  docker image ls "$IMAGE" --format '{{.CreatedAt}} {{.Tag}}' \
    | awk '$NF != "latest"' \
    | sort -r \
    | awk 'NR > 3 { print $NF }' \
    | while read -r tag; do
        docker rmi "$IMAGE:$tag" >/dev/null 2>&1 || true
      done || true
  log "старые образы удалены"
fi

log "готово: ${GIT_SHA:-без git}, слот $CAND_SLOT на :$CAND_PORT, $SITE_URL"
if cert_present && cert_covers_host; then
  log "SSL: сертификат $SITE_HOST действует до $(cert_expiry)"
fi
docker compose ps 2>/dev/null || true
