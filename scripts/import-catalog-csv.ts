/**
 * Import categories, products and pack sizes from a CSV (see src/server/modules/catalog/importers/catalog-csv.ts).
 *
 *   npm run catalog:import-csv -- --file prisma/catalog/shayvera-catalog.csv                  # dry run
 *   npm run catalog:import-csv -- --file prisma/catalog/shayvera-catalog.csv --stock 50 --apply
 *
 * Options:
 *   --apply            write to the database (otherwise only report what would happen)
 *   --stock N          stock for each NEWLY created pack size (default 0; existing stock is never changed)
 *   --keep-others      do not archive products that are missing from the file (default: archive them)
 *   --actor email      record this admin as the actor in the audit log
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { db } from "../src/server/platform/db";
import {
  importCatalogRows,
  parseCatalogCsv,
} from "../src/server/modules/catalog/importers/catalog-csv";
import { formatINR } from "../src/lib/money";

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      apply: { type: "boolean", default: false },
      stock: { type: "string", default: "0" },
      "keep-others": { type: "boolean", default: false },
      actor: { type: "string" },
    },
  });
  if (!values.file) {
    console.error(
      "Usage: npm run catalog:import-csv -- --file <catalog.csv> [--stock 50] [--apply]",
    );
    process.exit(1);
  }
  const stock = Number(values.stock);
  if (!Number.isInteger(stock) || stock < 0 || stock > 100_000)
    throw new Error("--stock must be 0–100000");

  const { rows, errors } = parseCatalogCsv(await readFile(values.file, "utf8"));
  if (errors.length) {
    console.error(
      `The file has ${errors.length} problem(s); nothing was imported:\n  ${errors.join("\n  ")}`,
    );
    process.exit(1);
  }
  const actor = values.actor
    ? await db.user.findFirst({ where: { email: values.actor.toLowerCase(), role: "ADMIN" } })
    : null;
  if (values.actor && !actor) throw new Error(`No admin with email ${values.actor}`);

  const report = await importCatalogRows({
    rows,
    dryRun: !values.apply,
    initialStock: stock,
    archiveOthers: !values["keep-others"],
    actorId: actor?.id ?? null,
  });

  console.log(
    report.dryRun
      ? "\nDRY RUN — nothing was written. Re-run with --apply.\n"
      : "\nImport applied.\n",
  );
  console.log("Categories:");
  for (const c of report.categories)
    console.log(`  ${c.action === "create" ? "+ new " : "  upd "} ${c.name}`);
  console.log("\nProducts:");
  for (const p of report.products) {
    const prices = rows
      .filter((r) => r.product === p.name)
      .sort((a, b) => a.pack_grams - b.pack_grams)
      .map((r) => formatINR(Math.round(r.mrp_inr * 100)))
      .join(" / ");
    const changes = [
      p.variantsCreated && `${p.variantsCreated} new pack(s)`,
      p.variantsUpdated && `${p.variantsUpdated} updated`,
      p.variantsDeactivated && `${p.variantsDeactivated} old pack(s) hidden`,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      `  ${p.action === "create" ? "+ new " : "  upd "} ${p.name}${p.status === "DRAFT" ? " [DRAFT — hidden]" : ""}\n` +
        `         ${p.packs}: ${prices}  (${changes})`,
    );
  }
  if (report.archivedProducts.length)
    console.log(`\nArchived (hidden, not deleted): ${report.archivedProducts.join(", ")}`);
  if (report.hiddenCategories.length)
    console.log(`Hidden empty categories: ${report.hiddenCategories.join(", ")}`);
  const created = report.products.reduce((s, p) => s + p.variantsCreated, 0);
  console.log(
    `\n${report.products.length} products, ${created} new pack sizes${
      created ? ` with stock ${stock} each` : ""
    }.`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
