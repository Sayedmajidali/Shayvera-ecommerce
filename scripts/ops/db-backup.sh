#!/usr/bin/env bash
# Logical backup of the PostgreSQL database (custom format: compressed, restorable per table).
#
#   DATABASE_URL=postgresql://… BACKUP_DIR=/var/backups/shayvera scripts/ops/db-backup.sh
#
# Keeps the newest $BACKUP_KEEP (default 14) dumps. Read-only for the database. Run it from cron or a
# scheduled job on a machine that is NOT the database host, and copy the files off-site (object
# storage with versioning). Managed databases should also have point-in-time recovery enabled.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
url="${DATABASE_URL%%\?*}"            # pg_dump does not understand Prisma's ?schema= parameter
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/shayvera-$stamp.dump"
pg_dump --format=custom --no-owner --no-privileges --file="$file.partial" "$url"
mv "$file.partial" "$file"            # only complete dumps get the final name
sha256sum "$file" > "$file.sha256"
echo "Backup written: $file ($(du -h "$file" | cut -f1))"
# Retention: delete the oldest dumps beyond BACKUP_KEEP.
ls -1t "$BACKUP_DIR"/shayvera-*.dump 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | while read -r old; do
  rm -f "$old" "$old.sha256"
  echo "Removed old backup: $old"
done
