#!/usr/bin/env bash
# Turn on real email sending (order confirmations, password resets, staff alerts) — run on the server:
#
#   bash ~/shayvera/scripts/ops/set-email.sh
#
# Asks for the mailbox and its password (typed, never stored in shell history), writes EMAIL_PROVIDER,
# SMTP_URL (password URL-encoded), EMAIL_FROM and EMAIL_REPLY_TO into .env.production (backing it up
# first), restarts the app and sends a test email. Defaults suit Hostinger email (smtp.hostinger.com:465);
# override with SMTP_HOST / SMTP_PORT, e.g. SMTP_HOST=smtp.zoho.in bash set-email.sh.
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV="$APP_DIR/.env.production"
SMTP_HOST="${SMTP_HOST:-smtp.hostinger.com}"
SMTP_PORT="${SMTP_PORT:-465}"
[ -f "$ENV" ] || { echo "Missing $ENV"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

read -rp "Mailbox to send from (e.g. orders@shayvera.in): " MAILBOX
read -rsp "Mailbox password (hidden): " MAILPASS; echo
read -rp "Sender name [Shayvera Food]: " SENDER
read -rp "Replies go to [$MAILBOX]: " REPLY_TO
read -rp "Send a test email to: " TEST_TO
SENDER="${SENDER:-Shayvera Food}"
REPLY_TO="${REPLY_TO:-$MAILBOX}"

valid() { [[ "$1" =~ ^[^[:space:]@\']+@[^[:space:]@\']+\.[^[:space:]@\']+$ ]]; }
valid "$MAILBOX" || { echo "Not a valid mailbox address"; exit 1; }
valid "$REPLY_TO" || { echo "Not a valid reply-to address"; exit 1; }
[ -n "$MAILPASS" ] || { echo "The password is required"; exit 1; }
case "$SENDER" in *"'"* | *"<"* | *">"*) echo "Sender name must not contain ' < >"; exit 1 ;; esac

# URL-encode user and password (read from stdin so they never appear in the process list).
enc() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=""))'; }
USER_ENC="$(printf '%s' "$MAILBOX" | enc)"
PASS_ENC="$(printf '%s' "$MAILPASS" | enc)"

cp "$ENV" "$ENV.bak-$(date +%Y%m%d-%H%M%S)"
grep -v -E '^(EMAIL_PROVIDER|SMTP_URL|EMAIL_FROM|EMAIL_REPLY_TO)=' "$ENV" > "$ENV.tmp" || true
{
  echo "EMAIL_PROVIDER='smtp'"
  echo "SMTP_URL='smtps://$USER_ENC:$PASS_ENC@$SMTP_HOST:$SMTP_PORT'"
  echo "EMAIL_FROM='$SENDER <$MAILBOX>'"
  echo "EMAIL_REPLY_TO='$REPLY_TO'"
} >> "$ENV.tmp"
mv "$ENV.tmp" "$ENV"
chmod 600 "$ENV"
echo "Saved: EMAIL_PROVIDER=smtp, SMTP_URL=smtps://$MAILBOX:(hidden)@$SMTP_HOST:$SMTP_PORT"
echo "       EMAIL_FROM=$SENDER <$MAILBOX>, EMAIL_REPLY_TO=$REPLY_TO"

[ "${SKIP_RESTART:-}" = 1 ] && exit 0
dc() { docker compose -f "$APP_DIR/docker-compose.prod.yml" --env-file "$ENV" "$@"; }
dc up -d
echo
if valid "$TEST_TO"; then
  dc run --rm migrate npm run --silent email:test -- --to "$TEST_TO"
else
  echo "No test address given — test later with: dc run --rm migrate npm run email:test -- --to you@example.com"
fi
