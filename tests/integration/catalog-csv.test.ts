import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import {
  importCatalogRows,
  packedWeight,
  parseCatalogCsv,
} from "@/server/modules/catalog/importers/catalog-csv";
import { makeCategory, makeProduct } from "../helpers/fixtures";

const CSV = `category,product,pack_grams,mrp_inr,gst_percent,status
Makhana,Jeera Makhana,100,190,5,active
Makhana,Jeera Makhana,50,115,5,active
Masalas,Garam Masala,1000,910,5,active
"Dry Fruits & Nuts",Walnuts,50,10,5,draft
"Dry Fruits & Nuts",Walnuts,100,10,5,active
`;

const run = (csv: string, extra: Partial<Parameters<typeof importCatalogRows>[0]> = {}) => {
  const { rows, errors } = parseCatalogCsv(csv);
  expect(errors).toEqual([]);
  return importCatalogRows({
    rows,
    dryRun: false,
    initialStock: 40,
    archiveOthers: true,
    ...extra,
  });
};

describe("catalogue CSV import", () => {
  it("validates the file and reports every problem", () => {
    expect(parseCatalogCsv("product,pack_grams\nX,50").errors).toEqual([
      'Missing column "category"',
      'Missing column "mrp_inr"',
      'Missing column "gst_percent"',
    ]);
    const bad = parseCatalogCsv(
      "category,product,pack_grams,mrp_inr,gst_percent,status\nA,Tea,0,10,5,active\nA,Tea,50,-1,5,maybe\nA,Coffee,50,10,5,\nA,Coffee,50,12,5,",
    );
    expect(bad.errors).toHaveLength(3); // zero grams; negative price + bad status; duplicate pack
    expect(bad.rows.map((r) => r.status)).toEqual(["active", "active"]); // blank status → active
  });

  it("parses the committed Shayvera catalogue without errors", () => {
    const { rows, errors } = parseCatalogCsv(
      readFileSync("prisma/catalog/shayvera-catalog.csv", "utf8"),
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(145);
    expect(new Set(rows.map((r) => r.product)).size).toBe(29);
  });

  it("dry run writes nothing", async () => {
    const report = await run(CSV, { dryRun: true });
    expect(report.products.map((p) => [p.name, p.action, p.status])).toEqual([
      ["Jeera Makhana", "create", "ACTIVE"],
      ["Garam Masala", "create", "ACTIVE"],
      ["Walnuts", "create", "DRAFT"],
    ]);
    expect(await db.product.count()).toBe(0);
    expect(await db.category.count()).toBe(0);
  });

  it("creates categories, products, pack sizes, stock and the stock ledger", async () => {
    await run(CSV);
    const cats = await db.category.findMany({ orderBy: { sortOrder: "asc" } });
    expect(cats.map((c) => [c.slug, c.isActive])).toEqual([
      ["makhana", true],
      ["masalas", true],
      ["dry-fruits-nuts", true],
    ]);
    const jeera = await db.product.findUniqueOrThrow({
      where: { slug: "jeera-makhana" },
      include: { variants: { include: { inventory: true }, orderBy: { sortOrder: "asc" } } },
    });
    expect(jeera.status).toBe("ACTIVE");
    expect(jeera.taxRateBps).toBe(500);
    expect(jeera.minPricePaise).toBe(11_500);
    expect(
      jeera.variants.map((v) => [
        v.sku,
        v.name,
        v.pricePaise,
        v.isDefault,
        v.inventory?.quantityOnHand,
      ]),
    ).toEqual([
      ["SHV-JEERA-MAKHANA-50G", "50 g", 11_500, true, 40],
      ["SHV-JEERA-MAKHANA-100G", "100 g", 19_000, false, 40],
    ]);
    expect(jeera.variants[0]!.weightGrams).toBe(packedWeight(50));
    expect((await db.product.findUniqueOrThrow({ where: { slug: "garam-masala" } })).status).toBe(
      "ACTIVE",
    );
    const garam = await db.productVariant.findUniqueOrThrow({
      where: { sku: "SHV-GARAM-MASALA-1000G" },
    });
    expect(garam.name).toBe("1 kg");
    // A product with any incomplete (draft) pack stays hidden.
    expect((await db.product.findUniqueOrThrow({ where: { slug: "walnuts" } })).status).toBe(
      "DRAFT",
    );
    expect(await db.inventoryTransaction.count({ where: { reason: "INITIAL", delta: 40 } })).toBe(
      5,
    );
    expect(await db.adminAuditLog.count({ where: { action: "product.import" } })).toBe(3);
  });

  it("re-running updates prices in place without touching stock", async () => {
    await run(CSV);
    const variant = await db.productVariant.findUniqueOrThrow({
      where: { sku: "SHV-JEERA-MAKHANA-100G" },
    });
    await db.inventory.update({ where: { variantId: variant.id }, data: { quantityOnHand: 7 } });

    const report = await run(CSV.replace("Jeera Makhana,100,190", "Jeera Makhana,100,199"), {
      initialStock: 999,
    });
    expect(report.products.every((p) => p.action === "update" && p.variantsCreated === 0)).toBe(
      true,
    );
    const after = await db.productVariant.findUniqueOrThrow({
      where: { sku: "SHV-JEERA-MAKHANA-100G" },
      include: { inventory: true },
    });
    expect(after.pricePaise).toBe(19_900);
    expect(after.inventory?.quantityOnHand).toBe(7);
    expect(await db.product.count()).toBe(3);
  });

  it("takes over an existing product with the same name, hiding its old pack sizes", async () => {
    const masalas = await makeCategory("Masalas");
    const old = await makeProduct({
      name: "Garam Masala",
      categoryId: masalas.id,
      variants: [{ sku: "GARMAS-01", name: "100 g", price: 9_900, stock: 12 }],
    });
    await db.product.update({ where: { id: old.id }, data: { slug: "garam-masala" } });

    await run(CSV);
    const product = await db.product.findUniqueOrThrow({
      where: { slug: "garam-masala" },
      include: { variants: true },
    });
    expect(product.id).toBe(old.id); // same product: URL, reviews and order history kept
    const byS = Object.fromEntries(product.variants.map((v) => [v.sku, v.isActive]));
    expect(byS).toEqual({ "GARMAS-01": false, "SHV-GARAM-MASALA-1000G": true });
    expect(product.minPricePaise).toBe(91_000);
  });

  it("archives products missing from the file and hides emptied categories (or keeps them)", async () => {
    const giftBoxes = await makeCategory("Gifts");
    const other = await makeProduct({ name: "Gift Box", categoryId: giftBoxes.id });

    await run(CSV, { archiveOthers: false });
    expect((await db.product.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("ACTIVE");

    const report = await run(CSV);
    expect(report.archivedProducts).toEqual(["Gift Box"]);
    expect(report.hiddenCategories).toEqual([giftBoxes.name]);
    expect((await db.product.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(
      "ARCHIVED",
    );
    expect((await db.category.findUniqueOrThrow({ where: { id: giftBoxes.id } })).isActive).toBe(
      false,
    );
  });
});
