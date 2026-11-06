import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import * as cartRoute from "@/app/api/cart/route";
import * as itemsRoute from "@/app/api/cart/items/route";
import * as itemRoute from "@/app/api/cart/items/[id]/route";
import * as couponRoute from "@/app/api/cart/coupon/route";
import * as mergeRoute from "@/app/api/cart/merge/route";
import { apiRequest, params, registerCustomer } from "../helpers/auth";
import { makeProduct } from "../helpers/fixtures";

async function guestAdd(variantId: string, quantity = 1, cookie?: string) {
  const res = await itemsRoute.POST(
    apiRequest("/api/cart/items", { method: "POST", body: { variantId, quantity }, cookie }),
    undefined,
  );
  const setCookie = res.headers.get("set-cookie");
  return { res, cookie: setCookie ? setCookie.split(";")[0]! : cookie };
}
async function getCart(cookie?: string, qs = "") {
  const res = await cartRoute.GET(apiRequest(`/api/cart${qs}`, { cookie }), undefined);
  return (await res.json()).data;
}

describe("guest cart", () => {
  it("creates a guest cart with an httpOnly cookie and prices it on the server", async () => {
    const p = await makeProduct({ price: 50_000, stock: 5 });
    const { res, cookie } = await guestAdd(p.variants[0]!.id, 2);
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toMatch(/shv_cart=.+HttpOnly; SameSite=Lax/);
    const cart = await getCart(cookie);
    expect(cart.lines).toHaveLength(1);
    expect(cart.pricing.subtotalPaise).toBe(100_000);
    expect(cart.pricing.shippingPaise).toBe(0); // above default ₹999 threshold
  });

  it("increments existing lines and refuses quantities beyond stock", async () => {
    const p = await makeProduct({ stock: 3 });
    const v = p.variants[0]!.id;
    const { cookie } = await guestAdd(v, 2);
    const again = await guestAdd(v, 2, cookie);
    expect(again.res.status).toBe(409);
    expect((await again.res.json()).error.code).toBe("OUT_OF_STOCK");
    const ok = await guestAdd(v, 1, cookie);
    expect(ok.res.status).toBe(201);
    expect((await getCart(cookie)).lines[0].quantity).toBe(3);
  });

  it.each([0, -1, 11, 1.5, "abc"])("rejects invalid quantity %s", async (q) => {
    const p = await makeProduct();
    const res = await itemsRoute.POST(
      apiRequest("/api/cart/items", {
        method: "POST",
        body: { variantId: p.variants[0]!.id, quantity: q },
      }),
      undefined,
    );
    expect(res.status).toBe(400);
  });

  it("rejects draft products and unknown variants", async () => {
    const draft = await makeProduct({ status: "DRAFT" });
    expect((await guestAdd(draft.variants[0]!.id)).res.status).toBe(404);
    expect((await guestAdd("nope")).res.status).toBe(404);
  });

  it("updates and removes lines, and isolates carts between guests", async () => {
    const p = await makeProduct({ stock: 10 });
    const { cookie: a } = await guestAdd(p.variants[0]!.id, 1);
    const { cookie: b } = await guestAdd(p.variants[0]!.id, 1);
    const itemA = (await getCart(a)).lines[0].id;

    const hijack = await itemRoute.PATCH(
      apiRequest(`/api/cart/items/${itemA}`, { method: "PATCH", cookie: b, body: { quantity: 5 } }),
      params({ id: itemA }),
    );
    expect(hijack.status).toBe(404);

    const upd = await itemRoute.PATCH(
      apiRequest(`/api/cart/items/${itemA}`, { method: "PATCH", cookie: a, body: { quantity: 4 } }),
      params({ id: itemA }),
    );
    expect(upd.status).toBe(200);
    expect((await getCart(a)).pricing.itemCount).toBe(4);

    const tooMany = await itemRoute.PATCH(
      apiRequest(`/api/cart/items/${itemA}`, {
        method: "PATCH",
        cookie: a,
        body: { quantity: 11 },
      }),
      params({ id: itemA }),
    );
    expect(tooMany.status).toBe(400);

    await itemRoute.DELETE(
      apiRequest(`/api/cart/items/${itemA}`, { method: "DELETE", cookie: a }),
      params({ id: itemA }),
    );
    expect((await getCart(a)).lines).toHaveLength(0);
  });

  it("flags lines whose stock dropped or product was deactivated and excludes them from totals", async () => {
    const p1 = await makeProduct({ price: 10_000, stock: 5 });
    const p2 = await makeProduct({ price: 20_000, stock: 5 });
    const { cookie } = await guestAdd(p1.variants[0]!.id, 4);
    await guestAdd(p2.variants[0]!.id, 1, cookie);
    await db.inventory.update({
      where: { variantId: p1.variants[0]!.id },
      data: { quantityOnHand: 2 },
    });
    await db.product.update({ where: { id: p2.id }, data: { status: "ARCHIVED" } });
    const cart = await getCart(cookie);
    expect(cart.issues.map((i: { type: string }) => i.type).sort()).toEqual([
      "INSUFFICIENT_STOCK",
      "UNAVAILABLE",
    ]);
    expect(cart.pricing.subtotalPaise).toBe(20_000); // 2 × ₹100 (clamped), archived line excluded
  });

  it("reflects price changes immediately (prices are never cached in the cart)", async () => {
    const p = await makeProduct({ price: 10_000 });
    const { cookie } = await guestAdd(p.variants[0]!.id, 1);
    await db.productVariant.update({
      where: { id: p.variants[0]!.id },
      data: { pricePaise: 12_500 },
    });
    expect((await getCart(cookie)).pricing.subtotalPaise).toBe(12_500);
  });
});

describe("coupons in the cart", () => {
  const couponReq = (code: string, cookie?: string) =>
    couponRoute.POST(
      apiRequest("/api/cart/coupon", { method: "POST", cookie, body: { code } }),
      undefined,
    );

  it("applies a valid coupon and re-validates it when the cart changes", async () => {
    await db.coupon.create({
      data: { code: "SAVE10", type: "PERCENTAGE", value: 1000, minOrderPaise: 100_000 },
    });
    const p = await makeProduct({ price: 60_000, stock: 5 });
    const { cookie } = await guestAdd(p.variants[0]!.id, 2);
    const res = await couponReq("save10", cookie);
    expect(res.status).toBe(200);
    expect((await res.json()).data.discountPaise).toBe(12_000);

    const item = (await getCart(cookie)).lines[0].id;
    await itemRoute.PATCH(
      apiRequest(`/api/cart/items/${item}`, { method: "PATCH", cookie, body: { quantity: 1 } }),
      params({ id: item }),
    );
    const cart = await getCart(cookie);
    expect(cart.coupon.applied).toBe(false);
    expect(cart.coupon.message).toContain("more to use");
    expect(cart.pricing.couponDiscountPaise).toBe(0);
  });

  it("rejects unknown, expired, exhausted and inactive coupons", async () => {
    const p = await makeProduct({ price: 60_000 });
    const { cookie } = await guestAdd(p.variants[0]!.id, 1);
    await db.coupon.createMany({
      data: [
        { code: "OLD", type: "FIXED", value: 1000, expiresAt: new Date(Date.now() - 1000) },
        { code: "USED", type: "FIXED", value: 1000, usageLimit: 1, usedCount: 1 },
        { code: "OFF", type: "FIXED", value: 1000, isActive: false },
      ],
    });
    for (const [code, msg] of [
      ["NOPE", "not valid"],
      ["OLD", "expired"],
      ["USED", "usage limit"],
      ["OFF", "not valid"],
    ] as const) {
      const res = await couponReq(code, cookie);
      expect(res.status).toBe(422);
      expect((await res.json()).error.message).toContain(msg);
    }
  });

  it("enforces per-customer coupon limits for signed-in users", async () => {
    const { user, cookie } = await registerCustomer("coupon@example.com");
    const coupon = await db.coupon.create({
      data: { code: "ONCE", type: "FIXED", value: 5000, usageLimitPerUser: 1 },
    });
    const p = await makeProduct({ price: 60_000 });
    await itemsRoute.POST(
      apiRequest("/api/cart/items", {
        method: "POST",
        cookie,
        body: { variantId: p.variants[0]!.id },
      }),
      undefined,
    );
    const order = await db.order.create({
      data: {
        orderNumber: "X1",
        email: user.email,
        phone: "9876543210",
        paymentMethod: "COD",
        shippingAddress: {},
        billingAddress: {},
        shippingStateCode: "KA",
        subtotalPaise: 1,
        totalPaise: 1,
        idempotencyKey: "i1",
        userId: user.id,
      },
    });
    await db.couponUsage.create({
      data: {
        couponId: coupon.id,
        orderId: order.id,
        userId: user.id,
        email: user.email,
        discountPaise: 5000,
      },
    });
    const res = await couponReq("ONCE", cookie);
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toContain("already used");
  });
});

describe("merging the guest cart after login", () => {
  it("moves guest items into the user cart, capped by stock", async () => {
    const p = await makeProduct({ stock: 5 });
    const v = p.variants[0]!.id;
    const { cookie: guest } = await guestAdd(v, 3);
    const { cookie: userCookie } = await registerCustomer("merge@example.com");
    await itemsRoute.POST(
      apiRequest("/api/cart/items", {
        method: "POST",
        cookie: userCookie,
        body: { variantId: v, quantity: 4 },
      }),
      undefined,
    );

    const res = await mergeRoute.POST(
      apiRequest("/api/cart/merge", { method: "POST", cookie: `${userCookie}; ${guest}` }),
      undefined,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("shv_cart=;");
    const cart = await getCart(userCookie);
    expect(cart.lines[0].quantity).toBe(5);
    expect(await db.cart.count({ where: { guestToken: { not: null } } })).toBe(0);
  });

  it("requires authentication", async () => {
    const res = await mergeRoute.POST(apiRequest("/api/cart/merge", { method: "POST" }), undefined);
    expect(res.status).toBe(401);
  });
});
