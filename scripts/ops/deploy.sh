#!/usr/bin/env bash
# Update the live site to the latest code on GitHub — run on the server:
#
#   bash ~/shayvera/scripts/ops/deploy.sh             # update (does nothing if already up to date)
#   bash ~/shayvera/scripts/ops/deploy.sh --force     # rebuild and restart even without new commits
#   bash ~/shayvera/scripts/ops/deploy.sh --rollback  # go back to the version before the last update
#
# Steps: check settings → back up the database → download new code → build new images while the old site
# keeps running → apply database migrations → restart web + worker → wait until healthy. If the new
# version does not become healthy, the previous version is restored automatically (migrations are
# additive, so the previous version runs against the new schema — PRODUCTION_READINESS.md §4).
# Never touches data volumes, .env.production or uploaded images.
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$APP_DIR/.env.production"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
BACKUP_DIR="${BACKUP_DIR:-$HOME/shayvera-backups}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"            # pre-deploy database backups to keep
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"     # seconds to wait for the new version
STATE_FILE="$APP_DIR/.deploy-previous"      # commit that was live before the last update
LOG_FILE="$APP_DIR/deploy.log"

cd "$APP_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mXX %s\033[0m\n' "$*"; exit 1; }

images() { dc config --images 2>/dev/null | sort -u; }

tag_images() { # tag_images <from-tag> <to-tag>: keeps a copy of the running images for instant rollback
  local img
  for img in $(images); do
    docker image inspect "$img:$1" >/dev/null 2>&1 && docker image tag "$img:$1" "$img:$2"
  done
  return 0
}

healthy() { # true once the web container reports healthy and the app answers "ok"
  local id status
  id="$(dc ps -q web 2>/dev/null)"
  [ -n "$id" ] || return 1
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null)"
  [ "$status" = "healthy" ] && curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'
}

wait_healthy() {
  local waited=0
  printf 'Waiting for the site to become healthy'
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    if healthy; then printf ' ok (%ss)\n' "$waited"; return 0; fi
    printf '.'; sleep 5; waited=$((waited + 5))
  done
  printf ' timed out\n'
  return 1
}

restore_previous() { # put back the images and code that were live before this update
  local prev="$1"
  warn "Restoring the previous version ($prev)…"
  tag_images previous latest
  git reset -q --hard "$prev"
  dc up -d --no-build --remove-orphans || true
  if wait_healthy; then
    warn "Previous version restored. The site is running the old code."
  else
    die "The previous version is not healthy either. Check: dc logs --tail 100 web"
  fi
}

backup_db() {
  if [ -z "$(dc ps -q db 2>/dev/null)" ]; then
    warn "Database container is not running — skipping the pre-deploy backup."
    return 0
  fi
  mkdir -p "$BACKUP_DIR"
  local file="$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S).dump"
  # shellcheck disable=SC2016 # expanded inside the container
  dc exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$file.partial"
  mv "$file.partial" "$file"
  echo "Database backup: $file ($(du -h "$file" | cut -f1))"
  ls -1t "$BACKUP_DIR"/pre-deploy-*.dump 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f
}

# ─── Checks ──────────────────────────────────────────────────────────────────────────────────────
MODE="${1:-update}"
case "$MODE" in update | --force | --rollback) ;; *) die "Unknown option: $MODE (use --force or --rollback)" ;; esac

echo
echo "──── Deploy $(date '+%Y-%m-%d %H:%M:%S') ($MODE) ────"
command -v docker >/dev/null || die "Docker is not installed."
[ -f "$ENV_FILE" ] || die "Missing $ENV_FILE — create the production settings first."
[ -f "$COMPOSE_FILE" ] || die "Missing $COMPOSE_FILE."
if ! git diff --quiet || ! git diff --cached --quiet; then
  git status --short
  die "Files in $APP_DIR were edited on the server. Make changes on your PC and push them to GitHub instead (or run: git stash)."
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" != "HEAD" ] || die "The code is not on a branch (detached). Run: git checkout <branch-name>"
CURRENT="$(git rev-parse --short HEAD)"

# ─── Rollback ────────────────────────────────────────────────────────────────────────────────────
if [ "$MODE" = "--rollback" ]; then
  [ -f "$STATE_FILE" ] || die "No previous version recorded yet (nothing has been deployed with this script)."
  PREV="$(cat "$STATE_FILE")"
  step "Rolling back from $CURRENT to $PREV"
  backup_db
  if docker image inspect "$(images | head -1):previous" >/dev/null 2>&1; then
    restore_previous "$PREV"
  else
    git reset -q --hard "$PREV"
    dc up -d --build --remove-orphans
    wait_healthy || die "The rolled-back version is not healthy. Check: dc logs --tail 100 web"
  fi
  echo "$CURRENT" > "$STATE_FILE" # rolling back again returns to the newer version
  step "Rolled back to $(git log -1 --format='%h %s')"
  echo "To update again later: bash $APP_DIR/scripts/ops/deploy.sh"
  exit 0
fi

# ─── Update ──────────────────────────────────────────────────────────────────────────────────────
step "1/6 Downloading the latest code ($BRANCH)"
git fetch --quiet origin "$BRANCH"
TARGET="$(git rev-parse --short "origin/$BRANCH")"
if [ "$CURRENT" = "$TARGET" ] && [ "$MODE" != "--force" ]; then
  echo "Already up to date ($CURRENT). Nothing to do — use --force to rebuild anyway."
  exit 0
fi
echo "Live now: $(git log -1 --format='%h %s')"
if [ "$CURRENT" != "$TARGET" ]; then
  echo "New changes:"
  git log --format='  %h %s' "HEAD..origin/$BRANCH"
fi

step "2/6 Backing up the database"
backup_db

step "3/6 Keeping a copy of the current version (for rollback)"
tag_images latest previous
echo "$CURRENT" > "$STATE_FILE"

step "4/6 Building the new version (the site stays online)"
git merge --quiet --ff-only "origin/$BRANCH" || die "Could not update the code (local commits on the server?)."
if ! dc build; then
  git reset -q --hard "$CURRENT"
  die "Build failed — nothing was changed on the live site. Fix the error above and push again."
fi

step "5/6 Applying database changes and restarting"
if ! dc up -d --remove-orphans; then
  dc logs --tail 40 migrate web || true
  restore_previous "$CURRENT"
  die "Update failed while starting (see the logs above). The previous version is live again."
fi

step "6/6 Checking the new version"
if ! wait_healthy; then
  dc logs --tail 60 web || true
  restore_previous "$CURRENT"
  die "The new version did not become healthy (logs above). The previous version is live again."
fi

docker image prune -f >/dev/null 2>&1 || true
step "Done — live: $(git log -1 --format='%h %s')"
echo "If something looks wrong: bash $APP_DIR/scripts/ops/deploy.sh --rollback"
