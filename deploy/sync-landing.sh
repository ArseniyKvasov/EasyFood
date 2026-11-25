#!/usr/bin/env bash
set -Eeuo pipefail

# Синхронизирует лендинг из репозитория BiteBalance в ./landing.
# Каталог landing/ — build-артефакт, в git не входит: Dockerfile копирует
# его в образ поверх собранного приложения.
#
#   ./deploy/sync-landing.sh
#   BITEBALANCE_DIR=/path/to/BiteBalance ./deploy/sync-landing.sh

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${BITEBALANCE_DIR:-$APP_DIR/../BiteBalance}"

if [[ ! -d "$SRC" ]]; then
  echo "ERROR: каталог BiteBalance не найден: $SRC" >&2
  echo "       укажите путь: BITEBALANCE_DIR=/path/to/BiteBalance $0" >&2
  exit 1
fi

rm -rf "$APP_DIR/landing"
mkdir -p "$APP_DIR/landing"
(cd "$SRC" && tar cf - --exclude=.git --exclude=node_modules .) | (cd "$APP_DIR/landing" && tar xf -)
echo "landing synced from $SRC"
