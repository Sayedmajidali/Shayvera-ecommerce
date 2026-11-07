#!/usr/bin/env bash
# Restores a dump made by db-backup.sh into an EMPTY database.
#
#   TARGET_DATABASE_URL=postgresql://…/shayvera_restore scripts/ops/db-restore.sh backups/shayvera-….dump
#
# Refuses a database that already has tables, so it cannot overwrite live data by accident. To
# replace production, restore into a new database, verify it, then point DATABASE_URL at it.
set -euo pipefail
dump="${1:?usage: db-restore.sh <file.dump>}"
: "${TARGET_DATABASE_URL:?set TARGET_DATABASE_URL (an empty database)}"
url="${TARGET_DATABASE_URL%%\?*}"
if [ -f "$dump.sha256" ]; then sha256sum --check --quiet "$dump.sha256"; fi
tables="$(psql "$url" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
if [ "$tables" != "0" ]; then
  echo "Refusing: the target database is not empty ($tables tables)." >&2
  exit 1
fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$url" "$dump"
echo "Restored $dump"
psql "$url" -Atc 'select count(*) || '"' orders, '"' || (select count(*) from "_prisma_migrations") || '"' migrations'"' from "Order"'
