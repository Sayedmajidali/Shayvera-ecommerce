import { z } from "zod";
import { db, type Tx } from "@/server/platform/db";
import { slugify } from "@/lib/validation/common";
import { audit } from "@/server/modules/audit/audit";
import { recomputeProductPrice } from "@/server/modules/catalog/catalog-admin";

/*
 * Catalogue import from a simple CSV (one row per pack size), e.g. prisma/catalog/shayvera-catalog.csv:
 *
 *   category,product,pack_grams,mrp_inr,gst_percent,status
 *   Makhana,Jeera Makhana,100,190,5,active
 *
 * - Categories and products are matched by slug (derived from the name), so re-running updates in place.
 * - Variants are matched by SKU (SHV-<PRODUCT-SLUG>-<GRAMS>G). Price, name, packed weight and order are
 *   updated; stock is set ONLY when a variant is created (`initialStock`) — existing stock is never touched.
 * - Pack sizes of an imported product that are no longer in the file are deactivated (never deleted, so
 *   order history stays intact).
 * - `archiveOthers`: products not in the file are ARCHIVED (hidden, reversible in Admin → Products) and
 *   categories left without visible products are hidden.
 * - Existing descriptions and images are kept; new products get a neutral description to edit later.
 */

const statusSchema = z.enum(["active", "draft"]);
const rowSchema = z.object({
  category: z.string().trim().min(1).max(80),
  product: z.string().trim().min(2).max(120),
  pack_grams: z.coerce.number().int().positive().max(100_000),
  mrp_inr: z.coerce.number().positive().max(1_000_000),
  gst_percent: z.coerce.number().min(0).max(28),
  status: z.string().trim().toLowerCase().pipe(statusSchema).default("active"),
});
export type CatalogRow = z.infer<typeof rowSchema>;

/** Minimal CSV parser (RFC 4180 quotes supported). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export function parseCatalogCsv(text: string): { rows: CatalogRow[]; errors: string[] } {
  const [header, ...body] = parseCsv(text);
  const errors: string[] = [];
  if (!header) return { rows: [], errors: ["The file is empty"] };
  const cols = header.map((h) => h.trim().toLowerCase());
  for (const required of ["category", "product", "pack_grams", "mrp_inr", "gst_percent"]) {
    if (!cols.includes(required)) errors.push(`Missing column "${required}"`);
  }
  if (errors.length) return { rows: [], errors };
  const rows: CatalogRow[] = [];
  const seen = new Set<string>();
  body.forEach((cells, i) => {
    const record = Object.fromEntries(cols.map((c, j) => [c, cells[j] ?? ""]));
    if (record.status === "") delete record.status;
    const parsed = rowSchema.safeParse(record);
    if (!parsed.success) {
      errors.push(
        `Line ${i + 2}: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`,
      );
      return;
    }
    const key = `${slugify(parsed.data.product)}:${parsed.data.pack_grams}`;
    if (seen.has(key))
      errors.push(
        `Line ${i + 2}: duplicate pack ${parsed.data.product} ${parsed.data.pack_grams} g`,
      );
    seen.add(key);
    rows.push(parsed.data);
  });
  return { rows, errors };
}

export const packName = (grams: number) =>
  grams >= 1000 && grams % 1000 === 0 ? `${grams / 1000} kg` : `${grams} g`;

export const variantSku = (productSlug: string, grams: number) =>
  `SHV-${productSlug.toUpperCase()}-${grams}G`;

/** Packed (shipping) weight: contents plus ~10% for packaging, at least 20 g, rounded up to 10 g. */
export const packedWeight = (grams: number) =>
  Math.ceil((grams + Math.max(20, grams * 0.1)) / 10) * 10;

const defaultDescription = (name: string, packs: number[]) =>
  `${name} from Shayvera Foods, carefully selected and hygienically packed. Available in ${packs
    .map(packName)
    .join(", ")} packs.`;

type ProductPlan = {
  name: string;
  slug: string;
  categorySlug: string;
  status: "ACTIVE" | "DRAFT";
  taxRateBps: number;
  packs: { grams: number; pricePaise: number }[];
};

export type CatalogImportReport = {
  dryRun: boolean;
  categories: { name: string; slug: string; action: "create" | "update" }[];
  products: {
    name: string;
    slug: string;
    status: "ACTIVE" | "DRAFT";
    action: "create" | "update";
    packs: string;
    variantsCreated: number;
    variantsUpdated: number;
    variantsDeactivated: number;
  }[];
  archivedProducts: string[];
  hiddenCategories: string[];
};

export async function importCatalogRows(opts: {
  rows: CatalogRow[];
  dryRun: boolean;
  initialStock: number;
  archiveOthers: boolean;
  actorId?: string | null;
}): Promise<CatalogImportReport> {
  const report: CatalogImportReport = {
    dryRun: opts.dryRun,
    categories: [],
    products: [],
    archivedProducts: [],
    hiddenCategories: [],
  };

  // Group rows: categories in file order, products in file order, packs sorted by size.
  const categoryOrder: { name: string; slug: string }[] = [];
  const plans = new Map<string, ProductPlan>();
  for (const r of opts.rows) {
    const categorySlug = slugify(r.category);
    if (!categoryOrder.some((c) => c.slug === categorySlug))
      categoryOrder.push({ name: r.category, slug: categorySlug });
    const slug = slugify(r.product);
    const plan = plans.get(slug) ?? {
      name: r.product,
      slug,
      categorySlug,
      status: "ACTIVE",
      taxRateBps: Math.round(r.gst_percent * 100),
      packs: [],
    };
    if (r.status === "draft") plan.status = "DRAFT"; // any incomplete pack keeps the product hidden
    plan.packs.push({ grams: r.pack_grams, pricePaise: Math.round(r.mrp_inr * 100) });
    plans.set(slug, plan);
  }
  for (const p of plans.values()) p.packs.sort((a, b) => a.grams - b.grams);

  const run = async (tx: Tx) => {
    const categoryIds = new Map<string, string>();
    for (const [i, c] of categoryOrder.entries()) {
      const existing = await tx.category.findUnique({ where: { slug: c.slug } });
      report.categories.push({ ...c, action: existing ? "update" : "create" });
      if (opts.dryRun) continue;
      const saved = existing
        ? await tx.category.update({
            where: { id: existing.id },
            data: { name: c.name, isActive: true, sortOrder: i },
          })
        : await tx.category.create({
            data: { name: c.name, slug: c.slug, isActive: true, sortOrder: i },
          });
      categoryIds.set(c.slug, saved.id);
    }

    for (const plan of plans.values()) {
      const existing = await tx.product.findUnique({
        where: { slug: plan.slug },
        include: { variants: true },
      });
      const outcome = {
        name: plan.name,
        slug: plan.slug,
        status: plan.status,
        action: existing ? ("update" as const) : ("create" as const),
        packs: plan.packs.map((p) => packName(p.grams)).join(", "),
        variantsCreated: 0,
        variantsUpdated: 0,
        variantsDeactivated: 0,
      };
      report.products.push(outcome);
      const wanted = new Set(plan.packs.map((p) => variantSku(plan.slug, p.grams)));
      if (existing) {
        for (const v of existing.variants) {
          if (wanted.has(v.sku)) outcome.variantsUpdated++;
          else if (v.isActive) outcome.variantsDeactivated++;
        }
        outcome.variantsCreated = wanted.size - outcome.variantsUpdated;
      } else outcome.variantsCreated = wanted.size;
      if (opts.dryRun) continue;

      const categoryId = categoryIds.get(plan.categorySlug)!;
      const product = existing
        ? await tx.product.update({
            where: { id: existing.id },
            data: {
              name: plan.name,
              categoryId,
              status: plan.status,
              taxRateBps: plan.taxRateBps,
              brand: existing.brand ?? "Shayvera Foods",
            },
          })
        : await tx.product.create({
            data: {
              name: plan.name,
              slug: plan.slug,
              brand: "Shayvera Foods",
              description: defaultDescription(
                plan.name,
                plan.packs.map((p) => p.grams),
              ),
              shortDescription: "Carefully selected and hygienically packed by Shayvera Foods.",
              categoryId,
              status: plan.status,
              taxRateBps: plan.taxRateBps,
              seoTitle: plan.name,
            },
          });

      // Variants that are not in the file: deactivate, and clear the default flag everywhere first.
      await tx.productVariant.updateMany({
        where: { productId: product.id },
        data: { isDefault: false },
      });
      await tx.productVariant.updateMany({
        where: { productId: product.id, sku: { notIn: [...wanted] } },
        data: { isActive: false },
      });

      for (const [i, pack] of plan.packs.entries()) {
        const sku = variantSku(plan.slug, pack.grams);
        const data = {
          name: packName(pack.grams),
          options: { Weight: packName(pack.grams) },
          pricePaise: pack.pricePaise,
          compareAtPricePaise: null,
          weightGrams: packedWeight(pack.grams),
          isActive: true,
          isDefault: i === 0,
          sortOrder: i,
        };
        const variant = await tx.productVariant.findUnique({ where: { sku } });
        if (variant && variant.productId !== product.id)
          throw new Error(`SKU ${sku} belongs to another product — rename one of them`);
        if (variant) {
          await tx.productVariant.update({ where: { id: variant.id }, data });
        } else {
          const created = await tx.productVariant.create({
            data: {
              ...data,
              productId: product.id,
              sku,
              inventory: { create: { quantityOnHand: opts.initialStock, lowStockThreshold: 5 } },
            },
          });
          if (opts.initialStock > 0) {
            await tx.inventoryTransaction.create({
              data: {
                variantId: created.id,
                delta: opts.initialStock,
                balanceAfter: opts.initialStock,
                reason: "INITIAL",
                note: "Catalogue import",
                actorId: opts.actorId ?? null,
              },
            });
          }
        }
      }
      await recomputeProductPrice(tx, product.id);
      await audit(
        {
          actorId: opts.actorId ?? null,
          action: existing ? "product.import.update" : "product.import",
          entityType: "Product",
          entityId: product.id,
          metadata: { source: "catalog-csv", packs: outcome.packs, status: plan.status },
        },
        tx,
      );
    }

    if (opts.archiveOthers) {
      const others = await tx.product.findMany({
        where: { slug: { notIn: [...plans.keys()] }, status: { not: "ARCHIVED" } },
        select: { id: true, name: true },
      });
      report.archivedProducts = others.map((p) => p.name);
      if (!opts.dryRun && others.length) {
        await tx.product.updateMany({
          where: { id: { in: others.map((p) => p.id) } },
          data: { status: "ARCHIVED", isFeatured: false },
        });
        for (const p of others) {
          await audit(
            {
              actorId: opts.actorId ?? null,
              action: "product.archive",
              entityType: "Product",
              entityId: p.id,
              metadata: { source: "catalog-csv" },
            },
            tx,
          );
        }
      }
      const keep = categoryOrder.map((c) => c.slug);
      const empty = await tx.category.findMany({
        where: {
          slug: { notIn: keep },
          isActive: true,
          products: {
            none: {
              status: "ACTIVE",
              ...(opts.dryRun ? { slug: { in: [...plans.keys()] } } : {}),
            },
          },
        },
        select: { id: true, name: true },
      });
      report.hiddenCategories = empty.map((c) => c.name);
      if (!opts.dryRun && empty.length) {
        await tx.category.updateMany({
          where: { id: { in: empty.map((c) => c.id) } },
          data: { isActive: false },
        });
      }
    }
  };

  if (opts.dryRun) await run(db as unknown as Tx);
  else await db.$transaction(run, { timeout: 120_000 });
  return report;
}
