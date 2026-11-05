/**
 * Payment reconciliation job. Expires unpaid online orders past their reservation window after
 * checking the gateway for captured payments. Schedule every 5–10 minutes in production
 * (cron / Windows Task Scheduler / platform scheduler):
 *
 *   npm run jobs:reconcile
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { expireStalePendingOrders } from "../src/server/services/payments";

async function main() {
  const result = await expireStalePendingOrders(500);
  console.log(`Checked ${result.checked} stale pending order(s); cancelled ${result.cancelled}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
