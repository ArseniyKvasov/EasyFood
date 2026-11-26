#!/usr/bin/env bash
set -Eeuo pipefail

# Проверка оплаты «изнутри» контейнера: какие переменные доехали, виден ли
# Т-Банк по DNS и по HTTPS. Запускать на сервере из любой папки:
#
#   ./deploy/check-billing.sh                 # сам найдёт рабочий контейнер
#   ./deploy/check-billing.sh bitebalance-app-green
#
# Ничего не меняет: только читает.

CONTAINER="${1:-}"

if [[ -z "$CONTAINER" ]]; then
  CONTAINER="$(docker ps --format '{{.Names}}' | grep -E '^bitebalance-app-' | head -n 1 || true)"
fi

if [[ -z "$CONTAINER" ]]; then
  echo "Не нашёл контейнер bitebalance-app-*: docker ps" >&2
  exit 1
fi

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "Контейнер $CONTAINER не найден" >&2
  exit 1
fi

echo "Контейнер: $CONTAINER"
echo

echo "== Переменные оплаты =="
docker exec "$CONTAINER" sh -c 'printenv | grep -E "^(TBANK_|SITE_URL|SMTP_|BILLING_)" || echo "(ничего не задано)"' \
  | sed -E 's/^(TBANK_PASSWORD|TBANK_TERMINAL_KEY|SMTP_PASS)=.*/\1=***/'
echo

BASE_URL="$(docker exec "$CONTAINER" sh -c 'printf %s "${TBANK_BASE_URL:-https://securepay.tinkoff.ru/v2}"')"

echo "== DNS: $(printf '%s' "$BASE_URL" | sed -E 's#^https?://([^/]+).*#\1#') =="
docker exec "$CONTAINER" node -e '
const url = new URL(process.argv[1]);
require("node:dns").lookup(url.hostname, (err, addr) => {
  console.log(err ? "ERR " + err.code + " — имя не резолвится" : "OK " + addr);
});
' "$BASE_URL" || true
echo

echo "== HTTPS: $BASE_URL/Init =="
docker exec "$CONTAINER" node -e '
const url = process.argv[1];
fetch(url + "/Init", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
  signal: AbortSignal.timeout(15000),
})
  .then((r) => console.log("HTTP", r.status, r.status < 500 ? "— сеть в порядке" : "— проблема на стороне банка"))
  .catch((e) => console.log("ERR", (e.cause && (e.cause.code || e.cause.message)) || e.message, "— сеть или DNS"));
' "$BASE_URL" || true
echo

echo "== Что видит приложение =="
PORT="$(docker exec "$CONTAINER" sh -c 'printf %s "${PORT:-3000}"')"
docker exec "$CONTAINER" node -e '
fetch("http://127.0.0.1:" + process.argv[1] + "/api/health")
  .then((r) => console.log("health:", r.status))
  .catch((e) => console.log("health: ERR", e.message));
' "$PORT" || true
echo
echo "Готово. Если DNS — OK, а HTTPS — ERR, проверь фаервол/прокси на сервере."
echo "Если HTTP 401/4xx — сеть в порядке, дело в ключах терминала."
