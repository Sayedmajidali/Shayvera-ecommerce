#!/usr/bin/env bash
# Turn on Razorpay online payments — run on the server:
#
#   bash ~/shayvera/scripts/ops/set-razorpay.sh
#
# Asks for the Key Id and Key Secret (hidden) from Razorpay → Account & Settings → API Keys, creates a
# webhook secret (or keeps the one already set), writes them into .env.production (backing it up first),
# restarts the app and checks the keys with Razorpay (read-only). Prints the webhook URL + secret to enter
# in Razorpay → Settings → Webhooks.
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV="$APP_DIR/.env.production"
[ -f "$ENV" ] || { echo "Missing $ENV"; exit 1; }

read -rp "Razorpay Key Id (rzp_test_… or rzp_live_…): " KEY_ID
read -rsp "Razorpay Key Secret (hidden): " KEY_SECRET; echo
[[ "$KEY_ID" =~ ^rzp_(test|live)_[A-Za-z0-9]+$ ]] || { echo "That does not look like a Razorpay Key Id"; exit 1; }
[[ "$KEY_SECRET" =~ ^[A-Za-z0-9]+$ ]] || { echo "The Key Secret should be letters and digits only"; exit 1; }
if [[ "$KEY_ID" == rzp_live_* ]]; then
  read -rp "These are LIVE keys (real money). Type LIVE to continue: " CONFIRM
  [ "$CONFIRM" = "LIVE" ] || { echo "Cancelled"; exit 1; }
fi

current() { grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- | tr -d "\"'"; }
WEBHOOK_SECRET="$(current RAZORPAY_WEBHOOK_SECRET || true)"
if [ -z "$WEBHOOK_SECRET" ] || [ "$WEBHOOK_SECRET" = "replace-me" ]; then
  WEBHOOK_SECRET="$(openssl rand -hex 24)"
fi

cp "$ENV" "$ENV.bak-$(date +%Y%m%d-%H%M%S)"
grep -v -E '^(PAYMENT_GATEWAY|RAZORPAY_KEY_ID|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET)=' "$ENV" > "$ENV.tmp" || true
{
  echo "PAYMENT_GATEWAY='razorpay'"
  echo "RAZORPAY_KEY_ID='$KEY_ID'"
  echo "RAZORPAY_KEY_SECRET='$KEY_SECRET'"
  echo "RAZORPAY_WEBHOOK_SECRET='$WEBHOOK_SECRET'"
} >> "$ENV.tmp"
mv "$ENV.tmp" "$ENV"
chmod 600 "$ENV"
echo "Saved: PAYMENT_GATEWAY=razorpay, RAZORPAY_KEY_ID=$KEY_ID, RAZORPAY_KEY_SECRET=(hidden)"

SITE="$(current NEXT_PUBLIC_APP_URL || true)"
echo
echo "In Razorpay → Account & Settings → Webhooks → Add New Webhook, enter:"
echo "  Webhook URL:    ${SITE:-https://your-domain}/api/webhooks/razorpay"
echo "  Secret:         $WEBHOOK_SECRET"
echo "  Active events:  payment.authorized, payment.captured, payment.failed, order.paid,"
echo "                  refund.processed, refund.failed"
echo

[ "${SKIP_RESTART:-}" = 1 ] && exit 0
dc() { docker compose -f "$APP_DIR/docker-compose.prod.yml" --env-file "$ENV" "$@"; }
dc up -d
echo
dc run --rm migrate npm run --silent payments:verify
