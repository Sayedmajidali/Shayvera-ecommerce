import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import { apiRequest, createAdmin, params, registerCustomer } from "../helpers/auth";
import { cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { makeProduct } from "../helpers/fixtures";
import * as reviewRoute from "@/app/api/products/[slug]/reviews/route";
import * as moderateRoute from "@/app/api/admin/reviews/[id]/route";
import { getStoreStats } from "@/server/modules/catalog/store-stats";

async function submit(slug: string, body: unknown, cookie?: string) {
  const res = await reviewRoute.POST(
    apiRequest(`/api/products/${slug}/reviews`, { method: "POST", body, cookie }),
    params({ slug }),
  );
  return { res, json: await res.json() };
}

async function moderate(id: string, status: string, cookie: string) {
  return moderateRoute.PATCH(
    apiRequest(`/api/admin/reviews/${id}`, { method: "PATCH", body: { status }, cookie }),
    params({ id }),
  );
}

const good = { rating: 4, title: "Lovely", body: "Fresh and fragrant, will order again." };

describe("customer reviews", () => {
  it("requires sign-in", async () => {
    const p = await makeProduct();
    expect((await submit(p.slug, good)).res.status).toBe(401);
  });

  it("validates rating and body", async () => {
    const p = await makeProduct();
    const { cookie } = await registerCustomer("val@example.com");
    const bad = await submit(p.slug, { rating: 0, body: "short" }, cookie);
    expect(bad.res.status).toBe(400);
    expect(Object.keys(bad.json.error.details ?? {})).toEqual(
      expect.arrayContaining(["rating", "body"]),
    );
    expect((await submit(p.slug, { ...good, rating: 6 }, cookie)).res.status).toBe(400);
  });

  it("is held for moderation and only counts towards the rating once approved", async () => {
    const p = await makeProduct();
    const { cookie } = await registerCustomer("rev@example.com");
    const { res, json } = await submit(p.slug, good, cookie);
    expect(res.status).toBe(201);
    expect(json.data.status).toBe("PENDING");
    let product = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(product.ratingCount).toBe(0);

    const { cookie: adminCookie } = await createAdmin();
    expect((await moderate(json.data.id, "APPROVED", adminCookie)).status).toBe(200);
    product = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(product).toMatchObject({ ratingCount: 1, ratingAverage: 4 });
    expect(await db.adminAuditLog.count({ where: { action: "review.approve" } })).toBe(1);

    // Editing sends it back to moderation and out of the published rating.
    const edited = await submit(p.slug, { ...good, rating: 2 }, cookie);
    expect(edited.json.data).toMatchObject({ id: json.data.id, status: "PENDING", rating: 2 });
    product = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(product.ratingCount).toBe(0);
    expect(await db.review.count()).toBe(1); // one review per customer per product
  });

  it("marks verified purchases only after a delivered order", async () => {
    const p = await makeProduct();
    const { user, cookie } = await registerCustomer("buyer@example.com");
    const cart = await cartWith(p.variants[0]!.id, 1, cookie);
    const { json } = await checkout(cart, checkoutBody({ email: "buyer@example.com" }));
    expect((await submit(p.slug, good, cookie)).json.data).toBeTruthy();
    expect(
      (await db.review.findFirstOrThrow({ where: { userId: user.id } })).verifiedPurchase,
    ).toBe(false);
    await db.order.update({ where: { id: json.data.orderId }, data: { status: "DELIVERED" } });
    await submit(p.slug, good, cookie);
    expect(
      (await db.review.findFirstOrThrow({ where: { userId: user.id } })).verifiedPurchase,
    ).toBe(true);
  });

  it("rejects reviews of hidden products", async () => {
    const p = await makeProduct({ status: "DRAFT" });
    const { cookie } = await registerCustomer("draft@example.com");
    expect((await submit(p.slug, good, cookie)).res.status).toBe(404);
  });

  it("lets only staff with catalogue permission moderate", async () => {
    const p = await makeProduct();
    const { cookie } = await registerCustomer("mod@example.com");
    const { json } = await submit(p.slug, good, cookie);
    expect((await moderate(json.data.id, "APPROVED", cookie)).status).toBe(403);
    const { cookie: adminCookie } = await createAdmin();
    expect((await moderate(json.data.id, "PUBLISHED", adminCookie)).status).toBe(400);
    expect((await moderate("nope", "APPROVED", adminCookie)).status).toBe(404);
  });
});

describe("store stats (About page)", () => {
  it("are computed from real data", async () => {
    expect(await getStoreStats()).toMatchObject({
      products: 0,
      happyKitchens: 0,
      ordersDelivered: 0,
      averageRating: null,
    });
    const p = await makeProduct();
    const cart = await cartWith(p.variants[0]!.id);
    const { json } = await checkout(cart, checkoutBody({ email: "kitchen@example.com" }));
    await db.order.update({ where: { id: json.data.orderId }, data: { status: "DELIVERED" } });
    const stats = await getStoreStats();
    expect(stats).toMatchObject({ products: 1, happyKitchens: 1, ordersDelivered: 1 });
  });
});
