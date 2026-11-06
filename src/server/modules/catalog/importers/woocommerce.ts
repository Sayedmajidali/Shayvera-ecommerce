import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/platform/db";
import { httpJson } from "@/server/platform/http";
import { logger } from "@/server/platform/logger";
import { storage } from "@/server/platform/storage";
import { audit } from "@/server/modules/audit/audit";
import { recomputeProductPrice, uniqueSlug } from "@/server/modules/catalog/catalog-admin";
import { processImageUpload, type ProcessedImage } from "@/server/modules/catalog/image-upload";
import { htmlToText, decodeEntities, truncateWords } from "./html-text";

/**
 * Imports a public WooCommerce catalog through the Store API (`/wp-json/wc/store/v1/products`),
 * which needs no credentials. Safety rules:
 * - products are created as DRAFT with zero stock; nothing appears on the storefront until staff
 *   review prices, pack sizes and stock and publish;
 * - re-running is idempotent (`Product.sourceRef`); products already published are never
 *   overwritten, drafts are only refreshed with `updateDrafts`;
 * - images are fetched only over HTTPS from the source host and go through the same validation and
 *   re-encoding as admin uploads;
 * - a dry run (the default in the CLI) reads and maps everything but writes nothing.
 */

// ───────────────────────────── Store API shapes ─────────────────────────────

const wooImage = z.object({
  src: z.string(),
  alt: z.string().optional().default(""),
  name: z.string().optional(),
});
const wooPrices = z.object({
  price: z.string(),
  regular_price: z.string().optional().default(""),
  sale_price: z.string().optional().default(""),
  currency_code: z.string(),
  currency_minor_unit: z.number().int().min(0).max(4),
});
const wooAttribute = z.object({
  name: z.string(),
  has_variations: z.boolean().optional().default(false),
  terms: z
    .array(z.object({ name: z.string() }))
    .optional()
    .default([]),
});
export const wooProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  type: z.string(),
  sku: z.string().optional().default(""),
  short_description: z.string().optional().default(""),
  description: z.string().optional().default(""),
  prices: wooPrices,
  categories: z
    .array(z.object({ name: z.string(), slug: z.string() }))
    .optional()
    .default([]),
  images: z.array(wooImage).optional().default([]),
  attributes: z.array(wooAttribute).optional().default([]),
  variations: z
    .array(
      z.object({
        id: z.number().int(),
        attributes: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
      }),
    )
    .optional()
    .default([]),
});
export type WooProduct = z.infer<typeof wooProductSchema>;

// ───────────────────────────── Normalised import model ─────────────────────────────

export type ImportVariant = {
  sku: string;
  name: string;
  options: Record<string, string>;
  pricePaise: number;
  compareAtPricePaise: number | null;
};

export type ImportProduct = {
  sourceRef: string;
  sourceId: number;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string;
  category: { slug: string; name: string } | null;
  images: { url: string; alt: string }[];
  attributes: { name: string; value: string }[];
  variants: ImportVariant[];
  warnings: string[];
};

/** Converts a Store API minor-unit price string to paise. */
export function toPaise(value: string, minorUnit: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return minorUnit === 2 ? n : Math.round(n * 10 ** (2 - minorUnit));
}

const cleanSku = (s: string) =>
  s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** Maps one Store API product (plus fetched variation details) to the import model. */
export function mapWooProduct(
  p: WooProduct,
  host: string,
  variations: WooProduct[] = [],
): ImportProduct | { skip: string } {
  if (p.prices.currency_code !== "INR")
    return { skip: `currency ${p.prices.currency_code} is not INR` };
  const warnings: string[] = [];
  const name = decodeEntities(p.name).trim();
  const short = htmlToText(p.short_description);
  let description = htmlToText(p.description);
  if (description.length < 10) {
    description = short || name;
    warnings.push("No long description on the source; used the short description");
  }

  const variantFrom = (
    src: WooProduct,
    label: string,
    options: Record<string, string>,
    fallbackSku: string,
  ) => {
    const price = toPaise(src.prices.price, src.prices.currency_minor_unit);
    const regular = toPaise(src.prices.regular_price, src.prices.currency_minor_unit);
    if (price === null || price < 100) return null;
    return {
      sku: cleanSku(src.sku) || fallbackSku,
      name: label,
      options,
      pricePaise: price,
      compareAtPricePaise: regular && regular > price ? regular : null,
    } satisfies ImportVariant;
  };

  const variants: ImportVariant[] = [];
  if (p.type === "variable" && p.variations.length > 0) {
    for (const v of p.variations) {
      const detail = variations.find((d) => d.id === v.id);
      if (!detail) {
        warnings.push(`Variation ${v.id} could not be loaded`);
        continue;
      }
      const options = Object.fromEntries(
        v.attributes
          .slice(0, 3)
          .map((a) => [decodeEntities(a.name).slice(0, 30), decodeEntities(a.value).slice(0, 60)]),
      );
      const label = Object.values(options).join(" / ") || `Option ${v.id}`;
      const variant = variantFrom(detail, label.slice(0, 80), options, `WOO-${v.id}`);
      if (variant) variants.push(variant);
      else warnings.push(`Variation ${v.id} has no usable price`);
    }
  } else {
    const variant = variantFrom(p, "Default", {}, `WOO-${p.id}`);
    if (variant) variants.push(variant);
    warnings.push(
      'Rename the "Default" variant to its pack size (e.g. 250 g) and set its packed weight',
    );
  }
  if (variants.length === 0) return { skip: "no purchasable price" };
  if (!p.sku.trim() && p.type !== "variable")
    warnings.push(`No SKU on the source; generated ${variants[0]!.sku}`);

  const category = p.categories[0]
    ? { slug: p.categories[0].slug, name: decodeEntities(p.categories[0].name).trim() }
    : null;
  if (!category) warnings.push("No category on the source");

  return {
    sourceRef: `woocommerce:${host}:${p.id}`,
    sourceId: p.id,
    name: name.slice(0, 120),
    slug: p.slug,
    shortDescription: short ? truncateWords(short, 200) : null,
    description: description.slice(0, 10_000),
    category,
    images: p.images.slice(0, 8).map((i) => ({
      url: i.src,
      alt: decodeEntities(i.alt || name).slice(0, 160),
    })),
    attributes: p.attributes
      .filter((a) => !a.has_variations && a.terms.length > 0)
      .slice(0, 30)
      .map((a) => ({
        name: decodeEntities(a.name).slice(0, 60),
        value: a.terms
          .map((t) => decodeEntities(t.name))
          .join(", ")
          .slice(0, 300),
      })),
    variants,
    warnings,
  };
}

// ───────────────────────────── Fetching ─────────────────────────────

export type Fetcher = typeof fetch;

export function sourceBase(url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Only https:// sources are supported");
  return { origin: u.origin, host: u.hostname.replace(/^www\./, "") };
}

/** Reads every product (100 per page, at most 20 pages) and the details of any variations. */
export async function fetchWooCatalog(siteUrl: string, fetchImpl: Fetcher = fetch) {
  const { origin } = sourceBase(siteUrl);
  const products: WooProduct[] = [];
  for (let page = 1; page <= 20; page++) {
    const body = await httpJson<unknown>(
      {
        url: `${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`,
        provider: "woocommerce",
        operation: "list-products",
        idempotent: true,
        timeoutMs: 20_000,
      },
      fetchImpl,
    );
    const list = z.array(wooProductSchema).parse(body);
    products.push(...list);
    if (list.length < 100) break;
  }
  const variations = new Map<number, WooProduct[]>();
  for (const p of products.filter((x) => x.type === "variable")) {
    const details: WooProduct[] = [];
    for (const v of p.variations.slice(0, 50)) {
      try {
        const body = await httpJson<unknown>(
          {
            url: `${origin}/wp-json/wc/store/v1/products/${v.id}`,
            provider: "woocommerce",
            operation: "get-variation",
            idempotent: true,
          },
          fetchImpl,
        );
        details.push(wooProductSchema.parse(body));
      } catch (error) {
        logger.warn("Could not load WooCommerce variation", {
          productId: p.id,
          variationId: v.id,
          error,
        });
      }
    }
    variations.set(p.id, details);
  }
  return { products, variations };
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Downloads an image only from the source host over HTTPS, with size and time limits. */
export async function downloadImage(url: string, sourceHost: string, fetchImpl: Fetcher = fetch) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  if (u.protocol !== "https:" || host !== sourceHost)
    throw new Error(`Refusing to download an image from ${u.hostname}`);
  const res = await fetchImpl(u, { signal: AbortSignal.timeout(20_000), redirect: "error" });
  if (!res.ok) throw new Error(`Image download failed with HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) throw new Error("Image is too large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("Image is too large");
  const name = decodeURIComponent(u.pathname.split("/").pop() ?? "image.jpg");
  return {
    name,
    size: buf.length,
    arrayBuffer: async () => new Uint8Array(buf).buffer as ArrayBuffer,
  };
}

// ───────────────────────────── Import ─────────────────────────────

export type ImportOutcome = {
  sourceRef: string;
  name: string;
  action: "create" | "update" | "skip";
  reason?: string;
  productId?: string;
  slug?: string;
  category?: string;
  images?: number;
  warnings: string[];
};

export type ImportReport = {
  dryRun: boolean;
  outcomes: ImportOutcome[];
  createdCategories: string[];
  /** Set when every imported price is identical — typical of placeholder prices on the source. */
  uniformPricePaise: number | null;
};

export type ImportOptions = {
  siteUrl: string;
  dryRun: boolean;
  /** Refresh text, attributes and category of products that are still DRAFT. */
  updateDrafts?: boolean;
  /** WooCommerce category slug → our category slug. */
  categoryMap?: Record<string, string>;
  actorId?: string | null;
  fetchImpl?: Fetcher;
  /** Defaults to UPLOAD_MAX_BYTES-style 5 MB after download validation. */
  maxImageBytes?: number;
};

async function resolveCategory(
  tx: Tx,
  c: ImportProduct["category"],
  map: Record<string, string>,
  created: string[],
  dryRun: boolean,
) {
  const fallback = { slug: "imported", name: "Imported" };
  const src = c ?? fallback;
  const mapped = map[src.slug];
  const bySlug = await tx.category.findUnique({ where: { slug: mapped ?? src.slug } });
  if (bySlug) return bySlug;
  const byName = await tx.category.findFirst({
    where: { name: { equals: src.name, mode: "insensitive" } },
  });
  if (byName) return byName;
  if (mapped) throw new Error(`Mapped category "${mapped}" does not exist`);
  if (!created.includes(src.name)) created.push(src.name);
  if (dryRun) return { id: "(new)", slug: src.slug, name: src.name };
  // Hidden until staff review it, so an empty or unwanted category never shows on the storefront.
  return tx.category.create({ data: { name: src.name, slug: src.slug, isActive: false } });
}

async function freeSku(tx: Tx, sku: string) {
  let candidate = sku;
  for (let i = 2; await tx.productVariant.findUnique({ where: { sku: candidate } }); i++)
    candidate = `${sku.slice(0, 36)}-${i}`;
  return candidate;
}

export async function importWooCatalog(opts: ImportOptions): Promise<ImportReport> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { host } = sourceBase(opts.siteUrl);
  const { products, variations } = await fetchWooCatalog(opts.siteUrl, fetchImpl);
  const report: ImportReport = {
    dryRun: opts.dryRun,
    outcomes: [],
    createdCategories: [],
    uniformPricePaise: null,
  };
  const map = opts.categoryMap ?? {};
  const maxImage = opts.maxImageBytes ?? 5 * 1024 * 1024;

  for (const raw of products) {
    const mapped = mapWooProduct(raw, host, variations.get(raw.id));
    if ("skip" in mapped) {
      report.outcomes.push({
        sourceRef: `woocommerce:${host}:${raw.id}`,
        name: raw.name,
        action: "skip",
        reason: mapped.skip,
        warnings: [],
      });
      continue;
    }
    const existing = await db.product.findUnique({ where: { sourceRef: mapped.sourceRef } });
    if (existing && (existing.status !== "DRAFT" || !opts.updateDrafts)) {
      report.outcomes.push({
        sourceRef: mapped.sourceRef,
        name: mapped.name,
        action: "skip",
        productId: existing.id,
        reason:
          existing.status !== "DRAFT"
            ? `already ${existing.status.toLowerCase()} — never overwritten`
            : "already imported (use --update-drafts to refresh)",
        warnings: [],
      });
      continue;
    }

    const outcome: ImportOutcome = {
      sourceRef: mapped.sourceRef,
      name: mapped.name,
      action: existing ? "update" : "create",
      warnings: [...mapped.warnings],
    };

    // Images are downloaded and validated before the transaction (network + CPU work).
    const stored: (ProcessedImage & { alt: string })[] = [];
    if (!opts.dryRun && !existing) {
      for (const img of mapped.images) {
        try {
          const file = await downloadImage(img.url, host, fetchImpl);
          stored.push({ ...(await processImageUpload(file, "products", maxImage)), alt: img.alt });
        } catch (error) {
          outcome.warnings.push(
            `Image skipped (${img.url.split("/").pop()}): ${error instanceof Error ? error.message : "error"}`,
          );
        }
      }
    }

    try {
      await db.$transaction(async (tx) => {
        const category = await resolveCategory(
          tx,
          mapped.category,
          map,
          report.createdCategories,
          opts.dryRun,
        );
        outcome.category = category.name;
        const text = {
          name: mapped.name,
          description: mapped.description,
          shortDescription: mapped.shortDescription,
        } satisfies Prisma.ProductUpdateInput;

        if (existing) {
          outcome.productId = existing.id;
          outcome.slug = existing.slug;
          if (opts.dryRun) return;
          await tx.product.update({
            where: { id: existing.id },
            data: { ...text, categoryId: category.id },
          });
          await tx.productAttribute.deleteMany({ where: { productId: existing.id } });
          await tx.productAttribute.createMany({
            data: mapped.attributes.map((a, i) => ({ productId: existing.id, ...a, sortOrder: i })),
          });
          await audit(
            {
              actorId: opts.actorId ?? null,
              action: "product.import.update",
              entityType: "Product",
              entityId: existing.id,
              metadata: { sourceRef: mapped.sourceRef },
            },
            tx,
          );
          return;
        }

        const slug = await uniqueSlug(mapped.slug || mapped.name, async (s) =>
          Boolean(await tx.product.findUnique({ where: { slug: s } })),
        );
        outcome.slug = slug;
        if (slug !== mapped.slug)
          outcome.warnings.push(`Slug "${mapped.slug}" was taken; using "${slug}"`);
        outcome.images = opts.dryRun ? mapped.images.length : stored.length;
        if (opts.dryRun) return;

        const product = await tx.product.create({
          data: {
            ...text,
            slug,
            sourceRef: mapped.sourceRef,
            status: "DRAFT",
            categoryId: category.id,
            attributes: { create: mapped.attributes.map((a, i) => ({ ...a, sortOrder: i })) },
            images: {
              create: stored.map((s, i) => ({
                url: s.url,
                storageKey: s.key,
                alt: s.alt,
                width: s.width,
                height: s.height,
                sizeBytes: s.sizeBytes,
                mimeType: s.mimeType,
                sortOrder: i,
              })),
            },
          },
        });
        for (const [i, v] of mapped.variants.entries()) {
          await tx.productVariant.create({
            data: {
              productId: product.id,
              sku: await freeSku(tx, v.sku),
              name: v.name,
              options: v.options,
              pricePaise: v.pricePaise,
              compareAtPricePaise: v.compareAtPricePaise,
              isDefault: i === 0,
              sortOrder: i,
              // Stock is unknown on the source: start at zero; staff set it before publishing.
              inventory: { create: { quantityOnHand: 0 } },
            },
          });
        }
        await recomputeProductPrice(tx, product.id);
        outcome.productId = product.id;
        await audit(
          {
            actorId: opts.actorId ?? null,
            action: "product.import",
            entityType: "Product",
            entityId: product.id,
            metadata: {
              sourceRef: mapped.sourceRef,
              variants: mapped.variants.length,
              images: stored.length,
            },
          },
          tx,
        );
      });
    } catch (error) {
      // Undo stored images for a product that was not created.
      await Promise.all(
        stored.map((s) =>
          storage()
            .delete(s.key)
            .catch(() => undefined),
        ),
      );
      outcome.action = "skip";
      outcome.reason = error instanceof Error ? error.message : "import failed";
    }
    report.outcomes.push(outcome);
  }

  const prices = report.outcomes
    .filter((o) => o.action !== "skip")
    .flatMap((o) => {
      const raw = products.find((p) => `woocommerce:${host}:${p.id}` === o.sourceRef);
      return raw ? [toPaise(raw.prices.price, raw.prices.currency_minor_unit)] : [];
    });
  if (prices.length > 1 && prices.every((p) => p === prices[0]))
    report.uniformPricePaise = prices[0] ?? null;
  return report;
}
