import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import * as wishlistRoute from "@/app/api/account/wishlist/route";
import * as wishlistItemRoute from "@/app/api/account/wishlist/[productId]/route";
import * as cartRoute from "@/app/api/cart/route";
import * as couponRoute from "@/app/api/cart/coupon/route";
import * as trackRoute from "@/app/api/orders/track/route";
import { getWishlist } from "@/server/modules/wishlist/wishlist";
import { getTrackingView } from "@/server/modules/orders/tracking";
import { resolveOrderForRequester } from "@/server/modules/orders/order-actions";
import { apiRequest, params, registerCustomer } from "../helpers/auth";
import { cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { makeProduct } from "../helpers/fixtures";

describe("wishlist", () => {
  const add = (cookie: string | undefined, productId: string) =>
    wishlistRoute.POST(
      apiRequest("/api/account/wishlist", { method: "POST", cookie, body: { productId } }),
      undefined,
    );
  const ids = async (cookie: string) =>
    (
      await (
        await wishlistRoute.GET(apiRequest("/api/account/wishlist", { cookie }), undefined)
      ).json()
    ).data.productIds as string[];

  it("saves, lists and removes products idempotently per user", async () => {
    const a = await registerCustomer("a@test.local");
    const b = await registerCustomer("b@test.local");
    const p1 = await makeProduct();
    const p2 = await makeProduct();
    expect((await add(a.cookie, p1.id)).status).toBe(201);
    expect((await add(a.cookie, p1.id)).status).toBe(201);
    await add(a.cookie, p2.id);
    expect((await ids(a.cookie)).sort()).toEqual([p1.id, p2.id].sort());
    expect(await ids(b.cookie)).toEqual([]);

    // Another user's DELETE cannot remove a's entry.
    await wishlistItemRoute.DELETE(
      apiRequest(`/api/account/wishlist/${p1.id}`, { method: "DELETE", cookie: b.cookie }),
      params({ productId: p1.id }),
    );
    expect(await ids(a.cookie)).toContain(p1.id);
    await wishlistItemRoute.DELETE(
      apiRequest(`/api/account/wishlist/${p1.id}`, { method: "DELETE", cookie: a.cookie }),
      params({ productId: p1.id }),
    );
    expect(await ids(a.cookie)).toEqual([p2.id]);
  });

  it("requires sign-in and only accepts products on sale", async () => {
    const p = await makeProduct();
    expect((await add(undefined, p.id)).status).toBe(401);
    const { cookie } = await registerCustomer("c@test.local");
    const draft = await makeProduct({ status: "DRAFT" });
    expect((await add(cookie, draft.id)).status).toBe(404);
    expect((await add(cookie, "does-not-exist")).status).toBe(404);
  });

  it("keeps products taken off sale but marks them unavailable", async () => {
    const { user, cookie } = await registerCustomer("d@test.local");
    const p = await makeProduct();
    await add(cookie, p.id);
    await db.product.update({ where: { id: p.id }, data: { status: "ARCHIVED" } });
    const list = await getWishlist(user.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.available).toBe(false);
  });
});

describe("buy now", () => {
  it("orders only the chosen item and leaves the cart and its coupon untouched", async () => {
    await db.coupon.create({ data: { code: "CART5", type: "FIXED", value: 500 } });
    const inCart = await makeProduct({ price: 40_000, stock: 5 });
    const buy = await makeProduct({ price: 70_000, stock: 5 });
    const cookie = await cartWith(inCart.variants[0]!.id, 2);
    await couponRoute.POST(
      apiRequest("/api/cart/coupon", { method: "POST", cookie, body: { code: "CART5" } }),
      undefined,
    );

    const { res, json } = await checkout(
      cookie,
      checkoutBody({ buyNow: { variantId: buy.variants[0]!.id, quantity: 2 } }),
    );
    expect(res.status).toBe(201);
    const order = await db.order.findUniqueOrThrow({
      where: { orderNumber: json.data.orderNumber },
      include: { items: true },
    });
    expect(order.items.map((i) => [i.variantId, i.quantity])).toEqual([[buy.variants[0]!.id, 2]]);
    expect(order.subtotalPaise).toBe(140_000);
    expect(order.couponCode).toBeNull();

    const cart = await db.cart.findFirstOrThrow({ include: { items: true } });
    expect(cart.couponCode).toBe("CART5");
    expect(cart.items.map((i) => [i.variantId, i.quantity])).toEqual([[inCart.variants[0]!.id, 2]]);
    const stock = async (variantId: string) =>
      (await db.inventory.findUniqueOrThrow({ where: { variantId } })).quantityOnHand;
    expect(await stock(buy.variants[0]!.id)).toBe(3);
    expect(await stock(inCart.variants[0]!.id)).toBe(5);
  });

  it("applies a coupon given at checkout and rejects invalid ones", async () => {
    await db.coupon.create({ data: { code: "BUY10", type: "PERCENTAGE", value: 1000 } });
    const p = await makeProduct({ price: 100_000, stock: 5 });
    const ok = await checkout(
      undefined,
      checkoutBody({ buyNow: { variantId: p.variants[0]!.id, quantity: 1 }, couponCode: "buy10" }),
    );
    expect(ok.res.status).toBe(201);
    const order = await db.order.findUniqueOrThrow({
      where: { orderNumber: ok.json.data.orderNumber },
    });
    expect(order).toMatchObject({ couponCode: "BUY10", couponDiscountPaise: 10_000 });
    expect(await db.couponUsage.count()).toBe(1);

    const bad = await checkout(
      undefined,
      checkoutBody({ buyNow: { variantId: p.variants[0]!.id, quantity: 1 }, couponCode: "NOPE" }),
    );
    expect(bad.res.status).toBe(422);
    expect(bad.json.error.code).toBe("COUPON_INVALID");
  });

  it("refuses more than the available stock and unknown products", async () => {
    const p = await makeProduct({ stock: 2 });
    const over = await checkout(
      undefined,
      checkoutBody({ buyNow: { variantId: p.variants[0]!.id, quantity: 3 } }),
    );
    expect(over.res.status).toBe(409);
    expect(over.json.error.code).toBe("OUT_OF_STOCK");
    const missing = await checkout(
      undefined,
      checkoutBody({ buyNow: { variantId: "nope", quantity: 1 } }),
    );
    expect(missing.res.status).toBe(422);
    const tooMany = await checkout(
      undefined,
      checkoutBody({ buyNow: { variantId: p.variants[0]!.id, quantity: 11 } }),
    );
    expect(tooMany.res.status).toBe(400);
  });

  it("previews a single-item price on the server", async () => {
    const p = await makeProduct({ price: 30_000, stock: 5 });
    const res = await cartRoute.GET(
      apiRequest(`/api/cart?buy=${p.variants[0]!.id}&qty=3&state=KA&payment=COD`),
      undefined,
    );
    const view = (await res.json()).data;
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0].quantity).toBe(3);
    expect(view.pricing.subtotalPaise).toBe(90_000);
    expect(view.id).toBeNull();
  });
});

describe("order tracking", () => {
  const track = (orderNumber: string, contact: string) =>
    trackRoute.POST(
      apiRequest("/api/orders/track", { method: "POST", body: { orderNumber, contact } }),
      undefined,
    );

  async function placed() {
    const p = await makeProduct({ stock: 5 });
    const cookie = await cartWith(p.variants[0]!.id, 1);
    const { json } = await checkout(cookie, checkoutBody());
    return db.order.findUniqueOrThrow({ where: { orderNumber: json.data.orderNumber } });
  }

  it("finds an order by email or phone in any common format", async () => {
    const order = await placed();
    for (const contact of ["BUYER@example.com", "9845012345", "+91 98450 12345", "098450-12345"]) {
      const res = await track(order.orderNumber.toLowerCase(), contact);
      expect(res.status, contact).toBe(200);
      expect((await res.json()).data.url).toMatch(new RegExp(`^/track/${order.orderNumber}\\?k=`));
    }
  });

  it("gives the same answer for a wrong contact and an unknown order", async () => {
    const order = await placed();
    const wrong = await track(order.orderNumber, "someone@example.com");
    const unknown = await track("SHV99999999", "buyer@example.com");
    expect(wrong.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect((await wrong.json()).error.message).toBe((await unknown.json()).error.message);
    expect((await track(order.orderNumber, "12345")).status).toBe(404);
  });

  it("issues a read-only token that exposes no personal data and grants no actions", async () => {
    const order = await placed();
    const url: string = (await (await track(order.orderNumber, "buyer@example.com")).json()).data
      .url;
    const token = new URL(url, "http://x").searchParams.get("k")!;
    const view = await getTrackingView(order.orderNumber, token);
    expect(view?.orderNumber).toBe(order.orderNumber);
    expect(view?.statusHistory.map((h) => h.toStatus)).toEqual(["PENDING", "CONFIRMED"]);
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/buyer@example\.com|9845012345|MG Road|shippingAddress/);
    expect(json).not.toContain(order.id);
    expect(await getTrackingView(order.orderNumber, "forged-token-value-1234567890ab")).toBeNull();
    // The tracking token does not open the full order (cancel/pay/address).
    await expect(
      resolveOrderForRequester(order.orderNumber, { userId: null, token }),
    ).rejects.toThrow();
  });

  it("validates input", async () => {
    const res = await track("not an order", "x@example.com");
    expect(res.status).toBe(400);
  });
});
