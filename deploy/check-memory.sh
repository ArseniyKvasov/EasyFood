#!/usr/bin/env bash
set -Eeuo pipefail

# Pre-deploy storage guard for deploy/production.sh.
#
# A deploy exhausts disk space rather than RAM: image pulls, migrations,
# nginx/container logs and growing backups all live on the same filesystems.
# This guard measures every filesystem the release touches.  Above the
# threshold it performs one bounded cleanup (stopped containers, rotated
# application/Docker logs, aged database dumps) and measures again.  A
# filesystem still above the threshold makes the script exit 1, so
# production.sh stops before it changes the live slot.
#
# Safety rules:
#   * only stopped containers are pruned, never running ones;
#   * Docker volumes, networks and tagged images are left untouched;
#   * the newest backups are always kept, even when they are older than the
#     retention window;
#   * the live application logs are never truncated, only rotated archives.
#
# Tunables (an exported shell variable wins over the value in .env):
#   MEMORY_GUARD_THRESHOLD_PERCENT=90
#   MEMORY_GUARD_TARGETS="/ /var/lib/docker"   # optional path override
#   MEMORY_GUARD_CONTAINER_AGE=24h             # docker prune --filter until
#   MEMORY_GUARD_LOG_RETENTION_DAYS=3
#   MEMORY_GUARD_BACKUP_RETENTION_DAYS=7
#   MEMORY_GUARD_BACKUP_KEEP=3
#   MEMORY_GUARD_LOG_DIRS="$APP_DIR/.runtime/logs"
#   MEMORY_GUARD_CLEAN_CONTAINERS=1
#   MEMORY_GUARD_CLEAN_LOGS=1
#   MEMORY_GUARD_CLEAN_BACKUPS=1
#   MEMORY_GUARD_CLEAN_DOCKER_LOGS=1
#   MEMORY_GUARD_DRY_RUN=0                     # 1 = report only, delete nothing

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

ENV_FILE="${BITEBALANCE_ENV_FILE:-$APP_DIR/.env}"

dotenv_value() {
  local expected_key="$1"
  local line key value

  [[ -r "$ENV_FILE" ]] || return 1
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
  done < "$ENV_FILE"
  return 1
}

log() { printf '[storage-guard] %s\n' "$*"; }
warn() { printf '[storage-guard] WARNING: %s\n' "$*" >&2; }
die() { printf '[storage-guard] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: deploy/check-memory.sh [--help]

Checks free disk space before a production deploy.  When a filesystem is more
than MEMORY_GUARD_THRESHOLD_PERCENT (default 90) full, it removes stopped
containers, rotated logs and backups older than the retention windows, then
checks again.  Exit code 1 means the deploy must stop.

Configuration is read from the shell environment and .env.  See the header of
this script for every supported variable.
EOF
}

case "${1:-}" in
  "" ) ;;
  -h|--help) usage; exit 0 ;;
  *) die "Unknown argument: $1 (use --help)" ;;
esac

threshold="${MEMORY_GUARD_THRESHOLD_PERCENT:-$(dotenv_value MEMORY_GUARD_THRESHOLD_PERCENT || true)}"
threshold="${threshold:-90}"
container_age="${MEMORY_GUARD_CONTAINER_AGE:-$(dotenv_value MEMORY_GUARD_CONTAINER_AGE || true)}"
container_age="${container_age:-24h}"
log_retention_days="${MEMORY_GUARD_LOG_RETENTION_DAYS:-$(dotenv_value MEMORY_GUARD_LOG_RETENTION_DAYS || true)}"
log_retention_days="${log_retention_days:-3}"
backup_retention_days="${MEMORY_GUARD_BACKUP_RETENTION_DAYS:-$(dotenv_value MEMORY_GUARD_BACKUP_RETENTION_DAYS || true)}"
backup_retention_days="${backup_retention_days:-7}"
backup_keep="${MEMORY_GUARD_BACKUP_KEEP:-$(dotenv_value MEMORY_GUARD_BACKUP_KEEP || true)}"
backup_keep="${backup_keep:-3}"
clean_containers="${MEMORY_GUARD_CLEAN_CONTAINERS:-1}"
clean_logs="${MEMORY_GUARD_CLEAN_LOGS:-1}"
clean_backups="${MEMORY_GUARD_CLEAN_BACKUPS:-1}"
clean_docker_logs="${MEMORY_GUARD_CLEAN_DOCKER_LOGS:-1}"
dry_run="${MEMORY_GUARD_DRY_RUN:-0}"

[[ "$threshold" =~ ^[0-9]+$ ]] && (( 10#$threshold >= 1 && 10#$threshold <= 100 )) \
  || die "MEMORY_GUARD_THRESHOLD_PERCENT must be an integer between 1 and 100"
threshold=$((10#$threshold))
[[ "$container_age" =~ ^[0-9]+(s|m|h)$ ]] \
  || die "MEMORY_GUARD_CONTAINER_AGE must look like 30m, 24h or 168h"
for pair in \
    "MEMORY_GUARD_LOG_RETENTION_DAYS=$log_retention_days" \
    "MEMORY_GUARD_BACKUP_RETENTION_DAYS=$backup_retention_days" \
    "MEMORY_GUARD_BACKUP_KEEP=$backup_keep"; do
  key="${pair%%=*}"
  value="${pair#*=}"
  [[ "$value" =~ ^[0-9]+$ ]] || die "$key must be a non-negative integer"
done
for flag in \
    "$clean_containers" "$clean_logs" "$clean_backups" \
    "$clean_docker_logs" "$dry_run"; do
  [[ "$flag" == "0" || "$flag" == "1" ]] \
    || die "Cleanup toggles and MEMORY_GUARD_DRY_RUN must be 0 or 1"
done
(( backup_keep >= 1 )) || die "MEMORY_GUARD_BACKUP_KEEP must be at least 1"

# Paths whose filesystems must survive the deploy: the root filesystem, the
# application (logs, backups, дампы базы) and Docker's data root.
targets=()
if [[ -n "${MEMORY_GUARD_TARGETS:-}" ]]; then
  # Deliberate word splitting: the variable is a space-separated path list.
  read -r -a targets <<< "$MEMORY_GUARD_TARGETS"
else
  targets=(/)
  [[ "$APP_DIR" == /* ]] && targets+=("$APP_DIR")
  [[ -d /var/lib/docker ]] && targets+=(/var/lib/docker)
fi
(( ${#targets[@]} > 0 )) || die "No filesystem paths to check"

human_kib() {
  awk -v kib="$1" 'BEGIN {
    split("KiB MiB GiB TiB PiB", unit, " ")
    value = kib + 0
    i = 1
    while (value >= 1024 && i < 5) {
      value /= 1024
      i++
    }
    if (i == 1) {
      printf "%d%s", value, unit[i]
    } else {
      printf "%.1f%s", value, unit[i]
    }
  }'
}

DISK_PERCENT=0
DISK_USED_KIB=0
DISK_WORST_MOUNT=""
DISK_REPORT=""

measure_disks() {
  local target raw percent used total avail mount seen
  DISK_PERCENT=0
  DISK_USED_KIB=0
  DISK_WORST_MOUNT=""
  DISK_REPORT=""
  seen=" "

  for target in "${targets[@]}"; do
    if [[ ! -e "$target" ]]; then
      warn "Skipping missing path: $target"
      continue
    fi
    raw="$(df -Pk "$target" 2>/dev/null | awk 'NR == 2 { gsub(/%/, "", $5); print $5, $3, $2, $4, $NF }')"
    if [[ -z "$raw" ]]; then
      warn "Cannot read filesystem usage for: $target"
      continue
    fi
    read -r percent used total avail mount <<< "$raw"

    # / and $APP_DIR usually live on the same mount; report each once.
    case "$seen" in *" $mount "*) continue ;; esac
    seen="${seen}${mount} "

    DISK_USED_KIB=$((DISK_USED_KIB + used))
    DISK_REPORT="${DISK_REPORT}$(printf '  %-30s %3s%% used, %s free of %s' \
      "$mount" "$percent" "$(human_kib "$avail")" "$(human_kib "$total")")"$'\n'
    if (( 10#$percent > DISK_PERCENT )); then
      DISK_PERCENT=$((10#$percent))
      DISK_WORST_MOUNT=$mount
    fi
  done

  (( ${#DISK_REPORT} > 0 )) || die "Could not measure any configured filesystem"
}

docker_ready() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

cleanup_containers() {
  (( clean_containers == 1 )) || return 0
  if ! docker_ready; then
    warn "Docker is unavailable; skipping stopped-container cleanup"
    return 0
  fi

  log "Removing stopped containers older than ${container_age}..."
  if (( dry_run == 1 )); then
    log "  DRY RUN: docker container prune -f --filter until=${container_age}"
    return 0
  fi
  docker container prune -f --filter "until=${container_age}" 2>&1 \
    | sed 's/^/  /' || warn "docker container prune failed; continuing"
}

cleanup_logs() {
  (( clean_logs == 1 )) || return 0
  local dir
  local dirs=()

  if [[ -n "${MEMORY_GUARD_LOG_DIRS:-}" ]]; then
    # Deliberate word splitting: the variable is a space-separated dir list.
    read -r -a dirs <<< "$MEMORY_GUARD_LOG_DIRS"
  else
    dirs=("$APP_DIR/.runtime/logs")
  fi

  for dir in "${dirs[@]}"; do
    [[ -d "$dir" ]] || continue
    log "Removing rotated logs older than ${log_retention_days}d from ${dir}..."
    if (( dry_run == 1 )); then
      find "$dir" -type f \
        \( -name '*.log.[0-9]*' -o -name '*.log-*' -o -name '*.log.*.gz' -o -name '*.gz' \) \
        -mtime "+${log_retention_days}" -print 2>/dev/null \
        | sed 's/^/  would remove: /' || true
    else
      find "$dir" -type f \
        \( -name '*.log.[0-9]*' -o -name '*.log-*' -o -name '*.log.*.gz' -o -name '*.gz' \) \
        -mtime "+${log_retention_days}" -print -delete 2>/dev/null \
        | sed 's/^/  removed: /' || true
    fi
  done
}

cleanup_docker_logs() {
  (( clean_docker_logs == 1 )) || return 0
  local containers_dir="${MEMORY_GUARD_DOCKER_ROOT:-/var/lib/docker}/containers"
  [[ -d "$containers_dir" ]] || return 0

  log "Removing rotated Docker container logs older than ${log_retention_days}d..."
  if (( dry_run == 1 )); then
    find "$containers_dir" -type f -name '*-json.log.*' \
      -mtime "+${log_retention_days}" -print 2>/dev/null \
      | sed 's/^/  would remove: /' || true
  else
    find "$containers_dir" -type f -name '*-json.log.*' \
      -mtime "+${log_retention_days}" -print -delete 2>/dev/null \
      | sed 's/^/  removed: /' || true
  fi
}

backup_listing() {
  local dir="$1"
  # GNU find prints a sortable mtime; BSD/macOS find falls back to stat.
  if find "$dir" -maxdepth 1 -type f -printf '' >/dev/null 2>&1; then
    find "$dir" -maxdepth 1 -type f -printf '%T@\t%p\n' 2>/dev/null | sort -rn
  else
    find "$dir" -maxdepth 1 -type f -exec stat -f '%m	%N' {} + 2>/dev/null | sort -rn
  fi
}

cleanup_backups() {
  (( clean_backups == 1 )) || return 0
  local dir="${BACKUP_DIR:-$(dotenv_value BACKUP_DIR || true)}"
  local now index mtime path age
  dir="${dir:-data/backups}"
  [[ "$dir" == /* ]] || dir="$APP_DIR/$dir"
  if [[ ! -d "$dir" ]]; then
    warn "Backup directory not found: $dir"
    return 0
  fi

  now="$(date +%s)"
  index=0
  log "Removing backups older than ${backup_retention_days}d (keeping newest ${backup_keep}) from ${dir}..."
  while IFS=$'\t' read -r mtime path; do
    [[ -n "$mtime" && -n "$path" && -f "$path" ]] || continue
    [[ "$mtime" =~ ^[0-9]+([.][0-9]+)?$ ]] || continue
    mtime="${mtime%%.*}"
    case "$path" in
      *.dump|*.dump.gz|*.sql|*.sql.gz) ;;
      *) continue ;;
    esac
    index=$((index + 1))
    (( index <= backup_keep )) && continue
    age=$(( (now - mtime) / 86400 ))
    (( age > backup_retention_days )) || continue
    if (( dry_run == 1 )); then
      log "  would remove: $path"
    elif rm -f -- "$path"; then
      log "  removed: $path"
    else
      warn "Could not remove $path"
    fi
  done < <(backup_listing "$dir")
}

show_diagnostics() {
  local dir
  log "Largest local storage consumers:"
  for dir in "$APP_DIR/.runtime/deploy/logs" "${BACKUP_DIR:-$APP_DIR/data/backups}"; do
    [[ -d "$dir" ]] || continue
    du -sh "$dir" 2>/dev/null | sed 's/^/  /' || true
  done
  if docker_ready; then
    docker system df 2>/dev/null | sed 's/^/  /' || true
  fi
}

measure_disks
log "Server storage usage (threshold: ${threshold}%):"
printf '%s' "$DISK_REPORT"

if (( DISK_PERCENT <= threshold )); then
  log "OK: worst filesystem ${DISK_WORST_MOUNT} is ${DISK_PERCENT}% full."
  exit 0
fi

log "ALERT: ${DISK_WORST_MOUNT} is ${DISK_PERCENT}% full (limit ${threshold}%); starting one cleanup pass."
before_percent=$DISK_PERCENT
before_used_kib=$DISK_USED_KIB

cleanup_containers
cleanup_logs
cleanup_docker_logs
cleanup_backups

measure_disks
freed_kib=$((before_used_kib - DISK_USED_KIB))
(( freed_kib >= 0 )) || freed_kib=0
log "Usage after cleanup (threshold: ${threshold}%):"
printf '%s' "$DISK_REPORT"
log "Worst filesystem: ${before_percent}% -> ${DISK_PERCENT}% full; $(human_kib "$freed_kib") reclaimed."

if (( DISK_PERCENT > threshold )); then
  show_diagnostics
  die "Server storage is still ${DISK_PERCENT}% full on ${DISK_WORST_MOUNT} (limit ${threshold}%); deploy stopped before any production change."
fi

log "OK after cleanup: worst filesystem ${DISK_WORST_MOUNT} is ${DISK_PERCENT}% full (limit ${threshold}%)."
