/**
 * Import products from a public WooCommerce store (Store API, no credentials needed).
 *
 *   npm run catalog:import-woo -- --url https://shayvera.in              # dry run (default)
 *   npm run catalog:import-woo -- --url https://shayvera.in --apply
 *   npm run catalog:import-woo -- --url https://shayvera.in --apply --map dry-fruits-nuts=dry-fruits
 *
 * Options:
 *   --apply            write to the database (otherwise only report what would happen)
 *   --update-drafts    refresh text/attributes/category of previously imported products still in DRAFT
 *   --map a=b          map WooCommerce category slug "a" to our category slug "b" (repeatable)
 *   --actor email      record this admin as the actor in the audit log
 *
 * Imported products are DRAFT with zero stock. Review prices, pack sizes, packed weight and stock,
 * then publish from Admin → Products.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { db } from "../src/server/platform/db";
import { importWooCatalog } from "../src/server/modules/catalog/importers/woocommerce";
import { formatINR } from "../src/lib/money";

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      apply: { type: "boolean", default: false },
      "update-drafts": { type: "boolean", default: false },
      map: { type: "string", multiple: true, default: [] },
      actor: { type: "string" },
    },
  });
  if (!values.url) {
    console.error("Usage: npm run catalog:import-woo -- --url https://example.com [--apply]");
    process.exit(1);
  }
  const categoryMap = Object.fromEntries(
    values.map!.map((m) => {
      const [from, to] = m.split("=");
      if (!from || !to) throw new Error(`Invalid --map "${m}" (expected woo-slug=our-slug)`);
      return [from.trim(), to.trim()];
    }),
  );
  const actor = values.actor
    ? await db.user.findFirst({ where: { email: values.actor.toLowerCase(), role: "ADMIN" } })
    : null;
  if (values.actor && !actor) throw new Error(`No admin with email ${values.actor}`);

  const report = await importWooCatalog({
    siteUrl: values.url,
    dryRun: !values.apply,
    updateDrafts: values["update-drafts"],
    categoryMap,
    actorId: actor?.id ?? null,
  });

  console.log(
    report.dryRun
      ? "\nDRY RUN — nothing was written. Re-run with --apply.\n"
      : "\nImport applied.\n",
  );
  for (const o of report.outcomes) {
    console.log(
      `${o.action.toUpperCase().padEnd(6)} ${o.name}${o.slug ? `  → /product/${o.slug}` : ""}${o.category ? `  [${o.category}]` : ""}${o.images !== undefined ? `  images: ${o.images}` : ""}`,
    );
    if (o.reason) console.log(`         ${o.reason}`);
    for (const w of o.warnings) console.log(`         ! ${w}`);
  }
  if (report.createdCategories.length)
    console.log(
      `\nNew categories (hidden until you activate them): ${report.createdCategories.join(", ")}`,
    );
  if (report.uniformPricePaise !== null)
    console.log(
      `\n! Every product has the same price (${formatINR(report.uniformPricePaise)}). This looks like a placeholder — set real prices before publishing.`,
    );
  const counts = report.outcomes.reduce<Record<string, number>>(
    (a, o) => ((a[o.action] = (a[o.action] ?? 0) + 1), a),
    {},
  );
  console.log(
    `\nSummary: ${JSON.stringify(counts)}. All imported products are DRAFT with zero stock.`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
