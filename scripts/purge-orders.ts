/**
 * Remove test orders permanently (see src/server/modules/orders/purge.ts for what is cleaned up).
 *
 *   npm run orders:purge -- --list                                   # show every order
 *   npm run orders:purge -- --orders SHV26000001,SHV26000002          # preview (nothing deleted)
 *   npm run orders:purge -- --orders SHV26000001,SHV26000002 --apply
 *   npm run orders:purge -- --all --reset-numbering --apply           # before launch: start again at …0001
 *
 * Options: --no-restock (do not put back stock taken by shipped test orders), --actor <admin email>.
 * Take a backup first (scripts/ops/backup.sh). Razorpay and Shiprocket records are not changed.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { db } from "../src/server/platform/db";
import { formatINR } from "../src/lib/money";
import { listOrdersForPurge, purgeOrders } from "../src/server/modules/orders/purge";

const fmtDate = (d: Date) =>
  d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

async function main() {
  const { values } = parseArgs({
    options: {
      list: { type: "boolean", default: false },
      orders: { type: "string" },
      all: { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      "no-restock": { type: "boolean", default: false },
      "reset-numbering": { type: "boolean", default: false },
      actor: { type: "string" },
    },
  });

  if (values.list) {
    const rows = await listOrdersForPurge();
    if (!rows.length) return console.log("There are no orders.");
    console.log(`${rows.length} order(s):`);
    for (const o of rows)
      console.log(
        `  ${o.orderNumber}  ${fmtDate(o.placedAt).padEnd(17)} ${o.status.padEnd(16)} ${o.paymentMethod.padEnd(8)} ${o.paymentStatus.padEnd(18)} ${formatINR(o.totalPaise).padStart(9)}  ${o.email}`,
      );
    return;
  }

  const orderNumbers = values.orders
    ?.split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (!values.all && !orderNumbers?.length) {
    console.error(
      "Usage: npm run orders:purge -- --list | --orders SHV…,SHV… [--apply] | --all [--reset-numbering] [--apply]",
    );
    process.exit(1);
  }
  const actor = values.actor
    ? await db.user.findFirst({ where: { email: values.actor.toLowerCase(), role: "ADMIN" } })
    : null;

  const r = await purgeOrders({
    orderNumbers,
    all: values.all,
    dryRun: !values.apply,
    restock: !values["no-restock"],
    resetNumbering: values["reset-numbering"],
    actorId: actor?.id ?? null,
  });

  console.log(
    r.dryRun ? "\nPREVIEW — nothing was deleted. Add --apply to delete.\n" : "\nDeleted.\n",
  );
  for (const o of r.orders)
    console.log(
      `  ${o.orderNumber}  ${fmtDate(o.placedAt).padEnd(17)} ${o.status.padEnd(16)} ${o.paymentStatus.padEnd(18)} ${formatINR(o.totalPaise).padStart(9)}  ${o.email}${o.invoice ? `  (invoice ${o.invoice})` : ""}`,
    );
  if (r.missing.length) console.log(`\nNot found: ${r.missing.join(", ")}`);
  console.log(
    `\n${r.orders.length} order(s); stock released: ${r.releasedUnits} unit(s); stock put back: ${r.restockedUnits} unit(s)${
      values["reset-numbering"]
        ? r.dryRun
          ? "; numbering will restart at 0001"
          : r.numberingReset
            ? "; numbering restarted"
            : ""
        : ""
    }.`,
  );
  if (r.orders.some((o) => o.invoice))
    console.log("Note: invoices of these orders are deleted with them (fine for test orders).");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
