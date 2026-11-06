import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import {
  importWooCatalog,
  mapWooProduct,
  toPaise,
  wooProductSchema,
} from "@/server/modules/catalog/importers/woocommerce";
import { makeCategory, makeProduct } from "../helpers/fixtures";

const SITE = "https://shop.example.in";
const prices = (price: string, regular = price, currency = "INR") => ({
  price,
  regular_price: regular,
  sale_price: price,
  currency_code: currency,
  currency_minor_unit: 2,
});

const catalog = [
  {
    id: 101,
    name: "Premium Cashew &amp; Co",
    slug: "premium-cashew",
    type: "simple",
    sku: "46872",
    short_description: "<p>Creamy <strong>W320</strong> cashews.</p>",
    description: "<p>Hand-graded cashews.</p><ul><li>Crunchy</li><li>Fresh</li></ul>",
    prices: prices("49900", "59900"),
    categories: [{ id: 1, name: "Dry Fruits &amp; Nuts", slug: "dry-fruits-nuts" }],
    images: [
      { src: `${SITE}/wp-content/uploads/cashew.png`, alt: "" },
      { src: "https://evil.example.com/x.png", alt: "" },
      { src: "http://shop.example.in/insecure.png", alt: "" },
    ],
    attributes: [{ name: "Grade", has_variations: false, terms: [{ name: "W320" }] }],
    variations: [],
  },
  {
    id: 102,
    name: "Roasted Makhana",
    slug: "roasted-makhana",
    type: "variable",
    sku: "",
    short_description: "",
    description: "<p>Light and crisp makhana, roasted not fried.</p>",
    prices: prices("19900"),
    categories: [{ id: 2, name: "Snacks", slug: "snacks" }],
    images: [],
    attributes: [
      { name: "Pack", has_variations: true, terms: [{ name: "100 g" }, { name: "250 g" }] },
    ],
    variations: [
      { id: 201, attributes: [{ name: "Pack", value: "100 g" }] },
      { id: 202, attributes: [{ name: "Pack", value: "250 g" }] },
    ],
  },
  {
    id: 103,
    name: "Imported Dates",
    slug: "dates",
    type: "simple",
    sku: "",
    description: "<p>Dates</p>",
    prices: prices("999", "999", "USD"),
    categories: [],
    images: [],
    attributes: [],
    variations: [],
  },
];
const variationDetails: Record<number, unknown> = {
  201: {
    ...catalog[1],
    id: 201,
    type: "variation",
    sku: "MAK-100",
    prices: prices("9900"),
    variations: [],
  },
  202: {
    ...catalog[1],
    id: 202,
    type: "variation",
    sku: "MAK-250",
    prices: prices("19900", "24900"),
    variations: [],
  },
};

let png: Buffer;
async function fakeFetch(input: string | URL | Request): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  png ??= await sharp({ create: { width: 400, height: 400, channels: 3, background: "#c8a165" } })
    .png()
    .toBuffer();
  if (url.pathname === "/wp-json/wc/store/v1/products") return Response.json(catalog);
  const v = url.pathname.match(/\/products\/(\d+)$/);
  if (v)
    return Response.json(variationDetails[Number(v[1])] ?? {}, {
      status: variationDetails[Number(v[1])] ? 200 : 404,
    });
  if (url.pathname.endsWith(".png"))
    return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
  return new Response("not found", { status: 404 });
}

const run = (o: Partial<Parameters<typeof importWooCatalog>[0]> = {}) =>
  importWooCatalog({ siteUrl: SITE, dryRun: false, fetchImpl: fakeFetch as typeof fetch, ...o });

describe("WooCommerce mapping", () => {
  it("converts minor units to paise", () => {
    expect(toPaise("6498", 2)).toBe(6498);
    expect(toPaise("65", 0)).toBe(6500);
    expect(toPaise("64980", 3)).toBe(6498);
    expect(toPaise("12.5", 2)).toBeNull();
  });

  it("maps text, prices and attributes and flags gaps", () => {
    const m = mapWooProduct(wooProductSchema.parse(catalog[0]), "shop.example.in");
    if ("skip" in m) throw new Error("unexpected skip");
    expect(m.name).toBe("Premium Cashew & Co");
    expect(m.description).toBe("Hand-graded cashews.\n\n• Crunchy\n• Fresh");
    expect(m.shortDescription).toBe("Creamy W320 cashews.");
    expect(m.variants).toEqual([
      {
        sku: "46872",
        name: "Default",
        options: {},
        pricePaise: 49_900,
        compareAtPricePaise: 59_900,
      },
    ]);
    expect(m.attributes).toEqual([{ name: "Grade", value: "W320" }]);
    expect(m.category).toEqual({ slug: "dry-fruits-nuts", name: "Dry Fruits & Nuts" });
    expect(m.warnings.join(" ")).toMatch(/pack size/);
  });

  it("skips non-INR products", () => {
    expect(mapWooProduct(wooProductSchema.parse(catalog[2]), "shop.example.in")).toEqual({
      skip: "currency USD is not INR",
    });
  });
});

describe("WooCommerce import", () => {
  it("dry run reports the plan and writes nothing", async () => {
    const report = await run({ dryRun: true });
    expect(report.outcomes.map((o) => [o.name, o.action])).toEqual([
      ["Premium Cashew & Co", "create"],
      ["Roasted Makhana", "create"],
      ["Imported Dates", "skip"],
    ]);
    expect(report.createdCategories.sort()).toEqual(["Dry Fruits & Nuts", "Snacks"]);
    expect(await db.product.count()).toBe(0);
    expect(await db.category.count()).toBe(0);
  });

  it("creates DRAFT products with zero stock, variants, attributes and validated images", async () => {
    const report = await run();
    const cashew = await db.product.findUniqueOrThrow({
      where: { sourceRef: "woocommerce:shop.example.in:101" },
      include: {
        variants: { include: { inventory: true } },
        attributes: true,
        images: true,
        category: true,
      },
    });
    expect(cashew.status).toBe("DRAFT");
    expect(cashew.category).toMatchObject({ name: "Dry Fruits & Nuts", isActive: false });
    expect(cashew.variants[0]).toMatchObject({
      sku: "46872",
      pricePaise: 49_900,
      compareAtPricePaise: 59_900,
    });
    expect(cashew.variants[0]!.inventory?.quantityOnHand).toBe(0);
    expect(cashew.attributes.map((a) => [a.name, a.value])).toEqual([["Grade", "W320"]]);
    // Only the HTTPS image from the source host is accepted, and it is re-encoded to WebP.
    expect(cashew.images).toHaveLength(1);
    expect(cashew.images[0]).toMatchObject({ mimeType: "image/webp", width: 400 });
    const warnings = report.outcomes
      .find((o) => o.name.startsWith("Premium Cashew"))!
      .warnings.join("\n");
    expect(warnings).toMatch(/evil\.example\.com/);
    expect(warnings).toMatch(/insecure\.png/);

    const makhana = await db.product.findUniqueOrThrow({
      where: { sourceRef: "woocommerce:shop.example.in:102" },
      include: { variants: { orderBy: { sortOrder: "asc" } } },
    });
    expect(
      makhana.variants.map((v) => [v.sku, v.name, v.options, v.pricePaise, v.compareAtPricePaise]),
    ).toEqual([
      ["MAK-100", "100 g", { Pack: "100 g" }, 9_900, null],
      ["MAK-250", "250 g", { Pack: "250 g" }, 19_900, 24_900],
    ]);
    expect(makhana.minPricePaise).toBe(9_900);
    expect(await db.adminAuditLog.count({ where: { action: "product.import" } })).toBe(2);
  });

  it("is idempotent, refreshes drafts only on request and never overwrites published products", async () => {
    await run();
    const second = await run();
    expect(second.outcomes.filter((o) => o.action === "skip")).toHaveLength(3);
    expect(await db.product.count()).toBe(2);

    const cashew = await db.product.findUniqueOrThrow({
      where: { sourceRef: "woocommerce:shop.example.in:101" },
    });
    await db.product.update({ where: { id: cashew.id }, data: { name: "Edited by staff" } });
    await run({ updateDrafts: true });
    expect((await db.product.findUniqueOrThrow({ where: { id: cashew.id } })).name).toBe(
      "Premium Cashew & Co",
    );

    await db.product.update({
      where: { id: cashew.id },
      data: { name: "Published name", status: "ACTIVE" },
    });
    const third = await run({ updateDrafts: true });
    expect(third.outcomes.find((o) => o.productId === cashew.id)?.reason).toMatch(
      /never overwritten/,
    );
    expect((await db.product.findUniqueOrThrow({ where: { id: cashew.id } })).name).toBe(
      "Published name",
    );
  });

  it("avoids slug and SKU clashes and honours category mapping", async () => {
    const ours = await makeCategory("Dry");
    await makeProduct({
      name: "Existing",
      variants: [{ sku: "46872", name: "1 kg", price: 10_000, stock: 1 }],
    });
    await db.product.updateMany({ where: { name: "Existing" }, data: { slug: "premium-cashew" } });
    const report = await run({ categoryMap: { "dry-fruits-nuts": ours.slug } });
    const cashew = await db.product.findUniqueOrThrow({
      where: { sourceRef: "woocommerce:shop.example.in:101" },
      include: { variants: true },
    });
    expect(cashew.slug).toBe("premium-cashew-2");
    expect(cashew.categoryId).toBe(ours.id);
    expect(cashew.variants[0]!.sku).toBe("46872-2");
    expect(report.createdCategories).toEqual(["Snacks"]);
  });

  it("flags identical prices as likely placeholders", async () => {
    const original = catalog[0]!.prices;
    catalog[0]!.prices = prices("19900");
    try {
      const report = await run({ dryRun: true });
      expect(report.uniformPricePaise).toBe(19_900);
    } finally {
      catalog[0]!.prices = original;
    }
  });

  it("rejects non-HTTPS sources", async () => {
    await expect(run({ siteUrl: "http://shop.example.in" })).rejects.toThrow(/https/);
  });
});
