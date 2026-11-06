import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import { drainJobs, availableStock } from "../helpers/db";
import * as orderRoute from "@/app/api/orders/[orderNumber]/route";
import * as cancelRoute from "@/app/api/orders/[orderNumber]/cancel/route";
import * as ordersRoute from "@/app/api/orders/route";
import { apiRequest, params, registerCustomer, createAdmin } from "../helpers/auth";
import { address, cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { makeProduct } from "../helpers/fixtures";

describe("COD checkout", () => {
  it("creates a confirmed order with immutable snapshots, reserves stock and empties the cart", async () => {
    const p = await makeProduct({ name: "Stoneware Mug", price: 59_000, stock: 10 });
    const v = p.variants[0]!;
    const cookie = await cartWith(v.id, 2);
    const { res, json } = await checkout(cookie, checkoutBody());
    expect(res.status).toBe(201);
    const { orderNumber, status, totalPaise } = json.data;
    expect(status).toBe("CONFIRMED");
    expect(orderNumber).toMatch(/^SHV\d{8}$/);
    // 2 × 590 = 1180 ≥ 999 free shipping; COD fee ₹49.
    expect(totalPaise).toBe(118_000 + 4900);

    const order = await db.order.findUniqueOrThrow({
      where: { orderNumber },
      include: { items: true, statusHistory: true, payments: true },
    });
    expect(order.paymentMethod).toBe("COD");
    expect(order.paymentStatus).toBe("PENDING");
    expect(order.items[0]).toMatchObject({
      productName: "Stoneware Mug",
      unitPricePaise: 59_000,
      quantity: 2,
      sku: v.sku,
    });
    expect(order.statusHistory.map((h) => h.toStatus)).toEqual(["PENDING", "CONFIRMED"]);
    expect(order.payments[0]).toMatchObject({
      method: "COD",
      status: "CREATED",
      amountPaise: order.totalPaise,
    });
    expect(await availableStock(v.id)).toBe(8);
    // Units are held as a reservation; nothing leaves the warehouse until the order ships.
    expect(
      await db.inventoryReservation.findMany({
        where: { orderId: order.id },
        select: { variantId: true, quantity: true, status: true, expiresAt: true },
      }),
    ).toEqual([{ variantId: v.id, quantity: 2, status: "ACTIVE", expiresAt: null }]);
    expect(
      (await db.inventory.findUniqueOrThrow({ where: { variantId: v.id } })).quantityOnHand,
    ).toBe(10);
    expect(await db.cartItem.count()).toBe(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).salesCount).toBe(2);
    await drainJobs();
    expect(
      (await db.outboundEmail.count({
        where: { template: "order-confirmed", to: "buyer@example.com" },
      })) === 1,
    ).toBe(true);

    // Later catalog price change does not alter the order snapshot.
    await db.productVariant.update({ where: { id: v.id }, data: { pricePaise: 99_900 } });
    expect(
      (await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).unitPricePaise,
    ).toBe(59_000);
  });

  it("ignores any client-supplied amounts", async () => {
    const p = await makeProduct({ price: 150_000 });
    const cookie = await cartWith(p.variants[0]!.id);
    const { json } = await checkout(cookie, {
      ...checkoutBody(),
      totalPaise: 1,
      subtotalPaise: 1,
      unitPrice: 1,
    });
    expect(json.data.totalPaise).toBe(150_000 + 4900);
  });

  it("is idempotent for repeated submissions", async () => {
    const p = await makeProduct({ stock: 5 });
    const cookie = await cartWith(p.variants[0]!.id, 1);
    const body = checkoutBody();
    const [a, b] = await Promise.all([checkout(cookie, body), checkout(cookie, body)]);
    const statuses = [a.res.status, b.res.status].sort();
    expect(statuses).toEqual([200, 201]);
    expect(a.json.data.orderNumber).toBe(b.json.data.orderNumber);
    expect(await db.order.count()).toBe(1);
    expect(await availableStock()).toBe(4);
    const again = await checkout(cookie, body);
    expect(again.json.data.idempotentReplay).toBe(true);
  });

  it("validates contact details, Indian phone and PIN code", async () => {
    const p = await makeProduct();
    const cookie = await cartWith(p.variants[0]!.id);
    const { res, json } = await checkout(
      cookie,
      checkoutBody({
        phone: "12345",
        shippingAddress: { ...address, pincode: "99", stateCode: "ZZ" },
      }),
    );
    expect(res.status).toBe(400);
    expect(Object.keys(json.error.details)).toEqual(
      expect.arrayContaining(["phone", "shippingAddress.pincode", "shippingAddress.stateCode"]),
    );
  });

  it("rejects empty carts and out-of-stock carts", async () => {
    expect((await checkout(undefined, checkoutBody())).res.status).toBe(422);
    const p = await makeProduct({ stock: 2 });
    const cookie = await cartWith(p.variants[0]!.id, 2);
    await db.inventory.update({
      where: { variantId: p.variants[0]!.id },
      data: { quantityOnHand: 1 },
    });
    const { res, json } = await checkout(cookie, checkoutBody());
    expect(res.status).toBe(409);
    expect(json.error.code).toBe("OUT_OF_STOCK");
    expect(await db.order.count()).toBe(0);
  });

  it("respects COD settings: disabled, blocked PIN codes and max order value", async () => {
    const p = await makeProduct({ price: 50_000, stock: 50 });
    const cookie = await cartWith(p.variants[0]!.id, 1);
    await db.storeSettings.update({
      where: { id: "default" },
      data: { codBlockedPincodes: ["560001"] },
    });
    expect((await checkout(cookie, checkoutBody())).json.error.message).toContain("PIN code");
    await db.storeSettings.update({
      where: { id: "default" },
      data: { codBlockedPincodes: [], codMaxOrderPaise: 10_000 },
    });
    expect((await checkout(cookie, checkoutBody())).json.error.message).toContain(
      "Cash on Delivery limit",
    );
    await db.storeSettings.update({ where: { id: "default" }, data: { codEnabled: false } });
    expect((await checkout(cookie, checkoutBody())).json.error.message).toContain("unavailable");
    expect(await db.order.count()).toBe(0);
  });

  it("applies GST split from the shipping state", async () => {
    await db.storeSettings.update({
      where: { id: "default" },
      data: { gstEnabled: true, stateCode: "KA" },
    });
    const p = await makeProduct({ price: 118_000, taxRateBps: 1800 });
    const intra = await checkout(await cartWith(p.variants[0]!.id), checkoutBody());
    const o1 = await db.order.findUniqueOrThrow({
      where: { orderNumber: intra.json.data.orderNumber },
    });
    expect(o1.cgstPaise + o1.sgstPaise).toBe(o1.taxPaise);
    expect(o1.igstPaise).toBe(0);
    const inter = await checkout(
      await cartWith(p.variants[0]!.id),
      checkoutBody({
        shippingAddress: { ...address, stateCode: "MH", pincode: "400001", city: "Mumbai" },
      }),
    );
    const o2 = await db.order.findUniqueOrThrow({
      where: { orderNumber: inter.json.data.orderNumber },
    });
    expect(o2.igstPaise).toBe(o2.taxPaise);
    expect(o2.taxPaise).toBeGreaterThan(0);
  });
});

describe("concurrency", () => {
  it("never oversells when many customers buy the last units at once", async () => {
    const p = await makeProduct({ stock: 3, price: 20_000 });
    const carts = await Promise.all(
      Array.from({ length: 8 }, () => cartWith(p.variants[0]!.id, 1)),
    );
    const results = await Promise.all(carts.map((c) => checkout(c, checkoutBody())));
    const ok = results.filter((r) => r.res.status === 201);
    const failed = results.filter((r) => r.res.status !== 201);
    expect(ok).toHaveLength(3);
    expect(failed.every((r) => r.json.error.code === "OUT_OF_STOCK")).toBe(true);
    expect(await availableStock()).toBe(0);
    expect(await db.order.count()).toBe(3);
  });

  it("enforces a coupon's global usage limit under concurrent checkouts", async () => {
    await db.coupon.create({
      data: { code: "LIMITED", type: "FIXED", value: 1000, usageLimit: 2 },
    });
    const p = await makeProduct({ stock: 20, price: 20_000 });
    const carts = await Promise.all(
      Array.from({ length: 5 }, () => cartWith(p.variants[0]!.id, 1)),
    );
    const { POST } = await import("@/app/api/cart/coupon/route");
    for (const c of carts)
      await POST(
        apiRequest("/api/cart/coupon", { method: "POST", cookie: c, body: { code: "LIMITED" } }),
        undefined,
      );
    const results = await Promise.all(
      carts.map((c, i) => checkout(c, checkoutBody({ email: `c${i}@example.com` }))),
    );
    expect(results.filter((r) => r.res.status === 201)).toHaveLength(2);
    expect((await db.coupon.findUniqueOrThrow({ where: { code: "LIMITED" } })).usedCount).toBe(2);
    expect(await db.couponUsage.count()).toBe(2);
  });

  it("generates unique sequential order numbers concurrently", async () => {
    const p = await makeProduct({ stock: 50 });
    const carts = await Promise.all(
      Array.from({ length: 6 }, () => cartWith(p.variants[0]!.id, 1)),
    );
    const results = await Promise.all(carts.map((c) => checkout(c, checkoutBody())));
    const numbers = results.map((r) => r.json.data.orderNumber);
    expect(new Set(numbers).size).toBe(6);
  });
});

describe("guest per-email coupon limits", () => {
  it("blocks a guest from reusing a once-per-customer coupon with the same email", async () => {
    await db.coupon.create({
      data: { code: "ONEPER", type: "FIXED", value: 1000, usageLimitPerUser: 1 },
    });
    const p = await makeProduct({ stock: 10 });
    const { POST } = await import("@/app/api/cart/coupon/route");
    const c1 = await cartWith(p.variants[0]!.id);
    await POST(
      apiRequest("/api/cart/coupon", { method: "POST", cookie: c1, body: { code: "ONEPER" } }),
      undefined,
    );
    expect((await checkout(c1, checkoutBody({ email: "same@example.com" }))).res.status).toBe(201);
    const c2 = await cartWith(p.variants[0]!.id);
    await POST(
      apiRequest("/api/cart/coupon", { method: "POST", cookie: c2, body: { code: "ONEPER" } }),
      undefined,
    );
    const second = await checkout(c2, checkoutBody({ email: "SAME@example.com" }));
    expect(second.res.status).toBe(422);
    expect(second.json.error.code).toBe("COUPON_INVALID");
  });
});

describe("order access and cancellation", () => {
  it("lets the owner list and view orders; other customers get 404", async () => {
    const a = await registerCustomer("owner@example.com");
    const b = await registerCustomer("other@example.com");
    const p = await makeProduct();
    await cartWith(p.variants[0]!.id, 1, a.cookie);
    const { json } = await checkout(a.cookie, checkoutBody({ email: "owner@example.com" }));
    const n = json.data.orderNumber;
    const list = await ordersRoute.GET(apiRequest("/api/orders", { cookie: a.cookie }), undefined);
    expect((await list.json()).data.orders).toHaveLength(1);
    expect(
      (
        await orderRoute.GET(
          apiRequest(`/api/orders/${n}`, { cookie: a.cookie }),
          params({ orderNumber: n }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await orderRoute.GET(
          apiRequest(`/api/orders/${n}`, { cookie: b.cookie }),
          params({ orderNumber: n }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await orderRoute.GET(apiRequest(`/api/orders/${n}`), params({ orderNumber: n }))).status,
    ).toBe(404);
  });

  it("lets a guest view their order only with the signed access token", async () => {
    const p = await makeProduct();
    const { json } = await checkout(await cartWith(p.variants[0]!.id), checkoutBody());
    const { orderNumber: n, accessToken } = json.data;
    expect(
      (
        await orderRoute.GET(
          apiRequest(`/api/orders/${n}?t=${accessToken}`),
          params({ orderNumber: n }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await orderRoute.GET(
          apiRequest(`/api/orders/${n}?t=forged-token-value`),
          params({ orderNumber: n }),
        )
      ).status,
    ).toBe(404);
  });

  it("cancels a confirmed COD order on approval, releasing stock and the coupon", async () => {
    await db.coupon.create({ data: { code: "BACK", type: "FIXED", value: 1000, usageLimit: 1 } });
    const p = await makeProduct({ stock: 5 });
    const cookie = await cartWith(p.variants[0]!.id, 2);
    const { POST } = await import("@/app/api/cart/coupon/route");
    await POST(
      apiRequest("/api/cart/coupon", { method: "POST", cookie, body: { code: "BACK" } }),
      undefined,
    );
    const { json } = await checkout(cookie, checkoutBody());
    const { orderNumber: n, accessToken } = json.data;
    const res = await cancelRoute.POST(
      apiRequest(`/api/orders/${n}/cancel`, {
        method: "POST",
        body: { token: accessToken, reason: "Changed my mind" },
      }),
      params({ orderNumber: n }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      outcome: "requested",
      status: "CANCELLATION_REQUESTED",
    });
    expect(await availableStock()).toBe(3); // still held until staff decide
    const { approveRequest } = await import("@/server/modules/orders/requests");
    const { user } = await createAdmin();
    const request = await db.orderRequest.findFirstOrThrow({
      where: { order: { orderNumber: n } },
    });
    expect(request).toMatchObject({
      type: "CANCELLATION",
      reason: "Changed my mind",
      previousStatus: "CONFIRMED",
    });
    await approveRequest(request.id, null, { id: user.id });
    expect(await availableStock()).toBe(5);
    expect((await db.coupon.findUniqueOrThrow({ where: { code: "BACK" } })).usedCount).toBe(0);
    const order = await db.order.findUniqueOrThrow({
      where: { orderNumber: n },
      include: { statusHistory: { orderBy: { createdAt: "asc" } } },
    });
    expect(order.status).toBe("CANCELLED");
    expect(
      order.statusHistory.slice(-2).map((h) => [h.fromStatus, h.toStatus, h.actorType]),
    ).toEqual([
      ["CONFIRMED", "CANCELLATION_REQUESTED", "CUSTOMER"],
      ["CANCELLATION_REQUESTED", "CANCELLED", "ADMIN"],
    ]);
    // Cancelling twice is rejected.
    const again = await cancelRoute.POST(
      apiRequest(`/api/orders/${n}/cancel`, { method: "POST", body: { token: accessToken } }),
      params({ orderNumber: n }),
    );
    expect(again.status).toBe(409);
  });

  it("rejects invalid status transitions", async () => {
    const { transitionOrder } = await import("@/server/modules/orders/orders");
    const p = await makeProduct();
    const { json } = await checkout(await cartWith(p.variants[0]!.id), checkoutBody());
    const order = await db.order.findUniqueOrThrow({
      where: { orderNumber: json.data.orderNumber },
    });
    await expect(
      db.$transaction((tx) =>
        transitionOrder(tx, { orderId: order.id, to: "DELIVERED", actor: { type: "SYSTEM" } }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
