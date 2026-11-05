import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as categoriesRoute from "@/app/api/admin/categories/route";
import * as categoryRoute from "@/app/api/admin/categories/[id]/route";
import * as productsRoute from "@/app/api/admin/products/route";
import * as productRoute from "@/app/api/admin/products/[id]/route";
import * as imagesRoute from "@/app/api/admin/products/[id]/images/route";
import * as variantRoute from "@/app/api/admin/variants/[id]/route";
import * as stockRoute from "@/app/api/admin/variants/[id]/stock/route";
import { listProducts, productListParamsSchema } from "@/server/queries/catalog";
import { apiRequest, createAdmin, params, registerCustomer } from "../helpers/auth";
import { makeCategory, makeProduct } from "../helpers/fixtures";

const productBody = (categoryId: string, sku = "TEST-MUG-01") => ({
  name: "Test Mug",
  description: "A lovely test mug for integration tests",
  categoryId,
  status: "ACTIVE",
  taxRateBps: 1200,
  hsnCode: "6912",
  variants: [
    {
      sku,
      name: "Blue",
      options: { Colour: "Blue" },
      pricePaise: 59_000,
      compareAtPricePaise: 69_000,
      initialStock: 25,
      isActive: true,
    },
  ],
});

async function uploadRequest(productId: string, cookie: string, file: File) {
  const form = new FormData();
  form.set("file", file);
  form.set("alt", "Alt text");
  return imagesRoute.POST(
    new Request(`http://localhost:3000/api/admin/products/${productId}/images`, {
      method: "POST",
      headers: { origin: "http://localhost:3000", cookie },
      body: form,
    }),
    params({ id: productId }),
  );
}

describe("admin authorization", () => {
  it("rejects customers and anonymous users from admin catalog APIs", async () => {
    const customer = await registerCustomer("cust@example.com");
    const anon = await productsRoute.GET(apiRequest("/api/admin/products"), undefined);
    expect(anon.status).toBe(401);
    const asCustomer = await productsRoute.GET(
      apiRequest("/api/admin/products", { cookie: customer.cookie }),
      undefined,
    );
    expect(asCustomer.status).toBe(403);
    const create = await categoriesRoute.POST(
      apiRequest("/api/admin/categories", {
        method: "POST",
        cookie: customer.cookie,
        body: { name: "Hacked" },
      }),
      undefined,
    );
    expect(create.status).toBe(403);
    expect(await db.category.count()).toBe(0);
  });
});

describe("category CRUD", () => {
  it("creates, updates and deletes categories; blocks deleting non-empty ones", async () => {
    const { cookie } = await createAdmin();
    const res = await categoriesRoute.POST(
      apiRequest("/api/admin/categories", { method: "POST", cookie, body: { name: "Home Décor" } }),
      undefined,
    );
    expect(res.status).toBe(201);
    const cat = (await res.json()).data;
    expect(cat.slug).toBe("home-decor");

    const upd = await categoryRoute.PUT(
      apiRequest(`/api/admin/categories/${cat.id}`, {
        method: "PUT",
        cookie,
        body: { name: "Home & Décor", slug: "home-decor", isActive: false },
      }),
      params({ id: cat.id }),
    );
    expect((await upd.json()).data.isActive).toBe(false);

    await makeProduct({ categoryId: cat.id });
    const blocked = await categoryRoute.DELETE(
      apiRequest(`/api/admin/categories/${cat.id}`, { method: "DELETE", cookie }),
      params({ id: cat.id }),
    );
    expect(blocked.status).toBe(409);

    const empty = await makeCategory("Empty");
    const del = await categoryRoute.DELETE(
      apiRequest(`/api/admin/categories/${empty.id}`, { method: "DELETE", cookie }),
      params({ id: empty.id }),
    );
    expect(del.status).toBe(200);
    expect(await db.adminAuditLog.count({ where: { entityType: "Category" } })).toBe(3);
  });
});

describe("product CRUD", () => {
  it("creates a product with variants, initial stock ledger and denormalised price", async () => {
    const { cookie } = await createAdmin();
    const cat = await makeCategory();
    const res = await productsRoute.POST(
      apiRequest("/api/admin/products", { method: "POST", cookie, body: productBody(cat.id) }),
      undefined,
    );
    expect(res.status).toBe(201);
    const product = (await res.json()).data;
    expect(product.slug).toBe("test-mug");
    expect(product.minPricePaise).toBe(59_000);
    const variant = await db.productVariant.findFirstOrThrow({
      where: { productId: product.id },
      include: { inventory: true },
    });
    expect(variant.inventory?.quantityOnHand).toBe(25);
    expect(
      await db.inventoryTransaction.count({ where: { variantId: variant.id, reason: "INITIAL" } }),
    ).toBe(1);
  });

  it("validates input and rejects duplicate SKUs", async () => {
    const { cookie } = await createAdmin();
    const cat = await makeCategory();
    const bad = await productsRoute.POST(
      apiRequest("/api/admin/products", {
        method: "POST",
        cookie,
        body: {
          ...productBody(cat.id),
          variants: [
            { ...productBody(cat.id).variants[0], pricePaise: -5, compareAtPricePaise: 10 },
          ],
        },
      }),
      undefined,
    );
    expect(bad.status).toBe(400);
    await productsRoute.POST(
      apiRequest("/api/admin/products", { method: "POST", cookie, body: productBody(cat.id) }),
      undefined,
    );
    const dup = await productsRoute.POST(
      apiRequest("/api/admin/products", {
        method: "POST",
        cookie,
        body: { ...productBody(cat.id), name: "Other" },
      }),
      undefined,
    );
    expect(dup.status).toBe(409);
  });

  it("updates price via variant and recomputes min price", async () => {
    const { cookie } = await createAdmin();
    const p = await makeProduct({
      variants: [
        { name: "A", price: 10_000, stock: 5 },
        { name: "B", price: 20_000, stock: 5 },
      ],
    });
    const a = p.variants[0]!;
    const res = await variantRoute.PUT(
      apiRequest(`/api/admin/variants/${a.id}`, {
        method: "PUT",
        cookie,
        body: { sku: a.sku, name: "A", pricePaise: 30_000, isActive: true },
      }),
      params({ id: a.id }),
    );
    expect(res.status).toBe(200);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).minPricePaise).toBe(
      20_000,
    );
  });

  it("deletes never-ordered products and archives ordered ones", async () => {
    const { cookie } = await createAdmin();
    const fresh = await makeProduct();
    const del = await productRoute.DELETE(
      apiRequest(`/api/admin/products/${fresh.id}`, { method: "DELETE", cookie }),
      params({ id: fresh.id }),
    );
    expect((await del.json()).data.action).toBe("deleted");

    const ordered = await makeProduct();
    await db.order.create({
      data: {
        orderNumber: "T-1",
        email: "x@example.com",
        phone: "9876543210",
        paymentMethod: "COD",
        shippingAddress: {},
        billingAddress: {},
        shippingStateCode: "KA",
        subtotalPaise: 100,
        totalPaise: 100,
        idempotencyKey: "k1",
        items: {
          create: [
            {
              productId: ordered.id,
              variantId: ordered.variants[0]!.id,
              productName: "x",
              productSlug: "x",
              variantName: "x",
              sku: "x",
              unitPricePaise: 100,
              quantity: 1,
              lineSubtotalPaise: 100,
              lineTotalPaise: 100,
            },
          ],
        },
      },
    });
    const arch = await productRoute.DELETE(
      apiRequest(`/api/admin/products/${ordered.id}`, { method: "DELETE", cookie }),
      params({ id: ordered.id }),
    );
    expect((await arch.json()).data.action).toBe("archived");
    expect((await db.product.findUniqueOrThrow({ where: { id: ordered.id } })).status).toBe(
      "ARCHIVED",
    );
    expect(await db.orderItem.count({ where: { productId: ordered.id } })).toBe(1);
  });

  it("adjusts stock with ledger and never below zero", async () => {
    const { cookie } = await createAdmin();
    const p = await makeProduct({ stock: 3 });
    const v = p.variants[0]!;
    const minus = await stockRoute.POST(
      apiRequest(`/api/admin/variants/${v.id}/stock`, {
        method: "POST",
        cookie,
        body: { delta: -5, reason: "DAMAGE" },
      }),
      params({ id: v.id }),
    );
    expect(minus.status).toBe(409);
    const plus = await stockRoute.POST(
      apiRequest(`/api/admin/variants/${v.id}/stock`, {
        method: "POST",
        cookie,
        body: { delta: 7, reason: "RESTOCK", note: "PO-12" },
      }),
      params({ id: v.id }),
    );
    expect((await plus.json()).data.quantityOnHand).toBe(10);
    const ledger = await db.inventoryTransaction.findFirstOrThrow({ where: { variantId: v.id } });
    expect(ledger.balanceAfter).toBe(10);
  });
});

describe("image uploads", () => {
  it("accepts a valid image, re-encodes to WebP and stores metadata", async () => {
    const { cookie } = await createAdmin();
    const p = await makeProduct();
    const png = await sharp({
      create: { width: 600, height: 750, channels: 3, background: "#c46f4e" },
    })
      .png()
      .toBuffer();
    const res = await uploadRequest(
      p.id,
      cookie,
      new File([new Uint8Array(png)], "photo.png", { type: "image/png" }),
    );
    expect(res.status).toBe(201);
    const img = (await res.json()).data;
    expect(img.mimeType).toBe("image/webp");
    expect(img.width).toBe(600);
    expect(img.url).toMatch(/^\/media\/products\/.+\.webp$/);
  });

  it.each([
    [
      "script disguised as png",
      Buffer.from("<script>alert(1)</script>".padEnd(200, " ")),
      "evil.png",
      415,
    ],
    [
      "svg",
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      "logo.svg",
      415,
    ],
    [
      "executable extension",
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]),
      "x.php",
      415,
    ],
  ])("rejects %s", async (_label, buf, name, status) => {
    const { cookie } = await createAdmin();
    const p = await makeProduct();
    const res = await uploadRequest(
      p.id,
      cookie,
      new File([new Uint8Array(buf)], name, { type: "image/png" }),
    );
    expect(res.status).toBe(status);
    expect(await db.productImage.count()).toBe(0);
  });

  it("rejects images that are too small or too large in bytes", async () => {
    const { cookie } = await createAdmin();
    const p = await makeProduct();
    const tiny = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#000" } })
      .png()
      .toBuffer();
    expect(
      (await uploadRequest(p.id, cookie, new File([new Uint8Array(tiny)], "tiny.png"))).status,
    ).toBe(400);
    const huge = Buffer.alloc(6 * 1024 * 1024, 1);
    expect(
      (await uploadRequest(p.id, cookie, new File([new Uint8Array(huge)], "huge.jpg"))).status,
    ).toBe(413);
  });

  it("rejects uploads from non-admins", async () => {
    const { cookie } = await registerCustomer("upload@example.com");
    const p = await makeProduct();
    const png = await sharp({
      create: { width: 400, height: 400, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    expect(
      (await uploadRequest(p.id, cookie, new File([new Uint8Array(png)], "a.png"))).status,
    ).toBe(403);
  });
});

describe("catalog search, filters, sorting, pagination", () => {
  it("filters by text, category, price and stock and sorts by price", async () => {
    const kitchen = await makeCategory("Kitchen");
    const bath = await makeCategory("Bath");
    await makeProduct({ name: "Blue Mug", categoryId: kitchen.id, price: 59_000, stock: 5 });
    await makeProduct({ name: "Red Mug", categoryId: kitchen.id, price: 79_000, stock: 0 });
    await makeProduct({ name: "Soap Bar", categoryId: bath.id, price: 34_900, stock: 9 });
    await makeProduct({ name: "Hidden Draft Mug", categoryId: kitchen.id, status: "DRAFT" });

    const q = (o: Record<string, unknown>) => listProducts(productListParamsSchema.parse(o));
    expect((await q({ q: "mug" })).items.map((p) => p.name).sort()).toEqual([
      "Blue Mug",
      "Red Mug",
    ]);
    expect((await q({ category: bath.slug })).total).toBe(1);
    expect((await q({ minPrice: "500", maxPrice: "700" })).items.map((p) => p.name)).toEqual([
      "Blue Mug",
    ]);
    expect((await q({ q: "mug", inStock: "1" })).items.map((p) => p.name)).toEqual(["Blue Mug"]);
    expect((await q({ sort: "price-asc" })).items.map((p) => p.name)).toEqual([
      "Soap Bar",
      "Blue Mug",
      "Red Mug",
    ]);
    expect((await q({ sort: "price-desc" })).items[0]!.name).toBe("Red Mug");
    // Invalid params fall back to safe defaults instead of erroring.
    expect((await q({ sort: "DROP TABLE", page: "-4" })).page).toBe(1);
  });

  it("paginates", async () => {
    const cat = await makeCategory();
    for (let i = 0; i < 14; i++) await makeProduct({ categoryId: cat.id });
    const p1 = await listProducts(productListParamsSchema.parse({ page: "1" }));
    const p2 = await listProducts(productListParamsSchema.parse({ page: "2" }));
    expect(p1.items).toHaveLength(12);
    expect(p2.items).toHaveLength(2);
    expect(p1.pageCount).toBe(2);
  });
});

describe("food product information", () => {
  it("stores ingredients, shelf life, storage, origin and veg flag", async () => {
    const { cookie } = await createAdmin();
    const cat = await makeCategory("Spices");
    const res = await productsRoute.POST(
      apiRequest("/api/admin/products", {
        method: "POST",
        cookie,
        body: {
          ...productBody(cat.id, "TURMERIC-200"),
          name: "Turmeric Powder",
          ingredients: "Turmeric (100%)",
          shelfLife: "12 months from packing",
          storageInfo: "Store in a cool, dry place",
          countryOfOrigin: "India",
          isVegetarian: true,
        },
      }),
      undefined,
    );
    expect(res.status).toBe(201);
    const p = (await res.json()).data;
    expect(p).toMatchObject({
      ingredients: "Turmeric (100%)",
      shelfLife: "12 months from packing",
      countryOfOrigin: "India",
      isVegetarian: true,
    });
    // Partial updates leave food fields untouched unless sent.
    const upd = await productRoute.PATCH(
      apiRequest(`/api/admin/products/${p.id}`, {
        method: "PATCH",
        cookie,
        body: { name: "Turmeric Powder (Haldi)" },
      }),
      params({ id: p.id }),
    );
    expect((await upd.json()).data).toMatchObject({
      name: "Turmeric Powder (Haldi)",
      ingredients: "Turmeric (100%)",
      isVegetarian: true,
    });
  });
});
