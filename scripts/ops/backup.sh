#!/usr/bin/env bash
# Daily backup of the live store (database + uploaded images) — run on the server.
#
#   bash ~/shayvera/scripts/ops/backup.sh                  # take a backup now
#   bash ~/shayvera/scripts/ops/backup.sh --install-cron   # run it every night at ~02:30 India time
#   bash ~/shayvera/scripts/ops/backup.sh --list           # show existing backups
#
# Writes to $BACKUP_DIR (default ~/shayvera-backups):
#   db-YYYYMMDD-HHMMSS.dump        PostgreSQL custom-format dump (restore: see deploy/VPS_DEPLOYMENT.md §11)
#   uploads-YYYYMMDD-HHMMSS.tgz    every uploaded image (logo, products, categories, …)
# Each database dump is checked by reading its table of contents back; a backup that fails the check is
# deleted and the run exits with an error. Read-only for the live site. Copies on this server are lost
# with the server — download them regularly (scp) or keep the hosting provider's snapshots on.
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$APP_DIR/.env.production"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
BACKUP_DIR="${BACKUP_DIR:-$HOME/shayvera-backups}"
KEEP_DB_DAYS="${KEEP_DB_DAYS:-14}"
KEEP_UPLOADS_DAYS="${KEEP_UPLOADS_DAYS:-7}"
CRON_FILE="/etc/cron.d/shayvera-backup"

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "ERROR: $*"; exit 1; }

case "${1:-}" in
  --install-cron)
    [ "$(id -u)" = 0 ] || die "Run --install-cron as root."
    # 02:30 India time, whatever the server clock's time zone is (IST or UTC; otherwise 02:30 local).
    case "$(date +%z)" in
      +0000) when="0 21" ;;
      *) when="30 2" ;;
    esac
    mkdir -p "$BACKUP_DIR"
    cat > "$CRON_FILE" <<EOF
# Shayvera nightly backup (installed by scripts/ops/backup.sh --install-cron)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
$when * * * root BACKUP_DIR=$BACKUP_DIR /bin/bash $APP_DIR/scripts/ops/backup.sh >> $BACKUP_DIR/backup.log 2>&1
EOF
    chmod 644 "$CRON_FILE"
    log "Nightly backup scheduled ($when * * * server time, $(date +%Z)). Log: $BACKUP_DIR/backup.log"
    exit 0
    ;;
  --list)
    ls -lh "$BACKUP_DIR" 2>/dev/null | grep -E 'db-|uploads-|pre-deploy-' || echo "No backups in $BACKUP_DIR yet."
    exit 0
    ;;
  "") ;;
  *) die "Unknown option: $1 (use --install-cron or --list)" ;;
esac

[ -f "$ENV_FILE" ] || die "Missing $ENV_FILE."
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
log "Backup started → $BACKUP_DIR"

# Free space: refuse below 1 GB so a backup can never fill the disk the live site needs.
free_kb="$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
[ "$free_kb" -gt 1048576 ] || die "Less than 1 GB free on the disk — backup skipped. Delete old backups or files."

[ -n "$(dc ps -q db 2>/dev/null)" ] || die "The database container is not running."

# 1. Database
db_file="$BACKUP_DIR/db-$stamp.dump"
# shellcheck disable=SC2016 # expanded inside the container
dc exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$db_file.partial" \
  || { rm -f "$db_file.partial"; die "pg_dump failed."; }
# Verify: the dump must be readable and contain the orders table.
if ! dc exec -T db pg_restore --list < "$db_file.partial" | grep -c ' TABLE public Order ' >/dev/null; then
  rm -f "$db_file.partial"
  die "The database dump failed verification — deleted."
fi
mv "$db_file.partial" "$db_file"
chmod 600 "$db_file"
log "Database: $(basename "$db_file") ($(du -h "$db_file" | cut -f1)), verified"

# 2. Uploaded images (read from the running web container's volume)
up_file="$BACKUP_DIR/uploads-$stamp.tgz"
if [ -n "$(dc ps -q web 2>/dev/null)" ]; then
  if dc exec -T web tar czf - -C /app/storage/uploads . > "$up_file.partial" && gzip -t "$up_file.partial"; then
    mv "$up_file.partial" "$up_file"
    chmod 600 "$up_file"
    log "Images:   $(basename "$up_file") ($(du -h "$up_file" | cut -f1)), $(tar tzf "$up_file" | grep -vc '/$') files"
  else
    rm -f "$up_file.partial"
    log "WARNING: image backup failed (database backup is fine)."
  fi
else
  log "WARNING: web container not running — image backup skipped."
fi

# 3. Retention
find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.dump' -mtime +"$KEEP_DB_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'uploads-*.tgz' -mtime +"$KEEP_UPLOADS_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name '*.partial' -mmin +120 -delete
log "Done. Keeping ${KEEP_DB_DAYS} days of database and ${KEEP_UPLOADS_DAYS} days of image backups ($(du -sh "$BACKUP_DIR" | cut -f1) in total)."
