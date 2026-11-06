import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import { eventually } from "../helpers/db";
import * as ordersRoute from "@/app/api/admin/orders/route";
import * as statusRoute from "@/app/api/admin/orders/[id]/status/route";
import * as shipRoute from "@/app/api/admin/orders/[id]/shipments/route";
import * as refundRoute from "@/app/api/admin/orders/[id]/refunds/route";
import * as invoiceRoute from "@/app/api/admin/orders/[id]/invoice/route";
import * as customersRoute from "@/app/api/admin/customers/route";
import * as customerRoute from "@/app/api/admin/customers/[id]/route";
import * as couponsRoute from "@/app/api/admin/coupons/route";
import * as couponRoute from "@/app/api/admin/coupons/[id]/route";
import * as settingsRoute from "@/app/api/admin/settings/route";
import * as dashboardRoute from "@/app/api/admin/dashboard/route";
import { getUserFromHeaders } from "@/server/modules/auth/session";
import type { InvoiceSnapshot } from "@/server/modules/invoices/invoices";
import { apiRequest, createAdmin, params, registerCustomer, signIn } from "../helpers/auth";
import { address, cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { makeProduct } from "../helpers/fixtures";

async function codOrder(o: { price?: number; stock?: number; state?: string } = {}) {
  const p = await makeProduct({
    price: o.price ?? 118_000,
    stock: o.stock ?? 10,
    taxRateBps: 1800,
  });
  const cookie = await cartWith(p.variants[0]!.id, 1);
  const { json } = await checkout(
    cookie,
    checkoutBody(
      o.state
        ? { shippingAddress: { ...address, stateCode: o.state, pincode: "400001", city: "Mumbai" } }
        : {},
    ),
  );
  return db.order.findUniqueOrThrow({ where: { orderNumber: json.data.orderNumber } });
}

const post = (path: string, cookie: string, body: unknown = {}) =>
  apiRequest(path, { method: "POST", cookie, body });

describe("admin access control", () => {
  it("returns 401/403 for every admin endpoint when not an admin", async () => {
    const { cookie } = await registerCustomer("nosy@example.com");
    const checks = [
      ordersRoute.GET(apiRequest("/api/admin/orders", { cookie }), undefined),
      customersRoute.GET(apiRequest("/api/admin/customers", { cookie }), undefined),
      couponsRoute.GET(apiRequest("/api/admin/coupons", { cookie }), undefined),
      settingsRoute.GET(apiRequest("/api/admin/settings", { cookie }), undefined),
      dashboardRoute.GET(apiRequest("/api/admin/dashboard", { cookie }), undefined),
      statusRoute.POST(
        post("/api/admin/orders/x/status", cookie, { status: "CANCELLED" }),
        params({ id: "x" }),
      ),
    ];
    for (const res of await Promise.all(checks)) expect(res.status).toBe(403);
    expect((await ordersRoute.GET(apiRequest("/api/admin/orders"), undefined)).status).toBe(401);
  });
});

describe("admin order management", () => {
  it("processes, ships with tracking, delivers (COD → paid) and logs every step", async () => {
    const { cookie } = await createAdmin();
    const order = await codOrder();
    const id = order.id;
    expect(
      (
        await statusRoute.POST(
          post(`/api/admin/orders/${id}/status`, cookie, { status: "PROCESSING" }),
          params({ id }),
        )
      ).status,
    ).toBe(200);
    // Shipping without a shipment is refused.
    expect(
      (
        await statusRoute.POST(
          post(`/api/admin/orders/${id}/status`, cookie, { status: "SHIPPED" }),
          params({ id }),
        )
      ).status,
    ).toBe(422);
    const ship = await shipRoute.POST(
      post(`/api/admin/orders/${id}/shipments`, cookie, {
        carrier: "Delhivery",
        trackingNumber: "AWB123",
        trackingUrl: "https://track.example/AWB123",
      }),
      params({ id }),
    );
    expect(ship.status).toBe(201);
    expect((await db.order.findUniqueOrThrow({ where: { id } })).status).toBe("SHIPPED");
    expect(
      (
        await statusRoute.POST(
          post(`/api/admin/orders/${id}/status`, cookie, { status: "DELIVERED" }),
          params({ id }),
        )
      ).status,
    ).toBe(200);
    const done = await db.order.findUniqueOrThrow({
      where: { id },
      include: { payments: true, shipments: true, statusHistory: true },
    });
    expect(done).toMatchObject({ status: "DELIVERED", paymentStatus: "PAID" });
    expect(done.payments[0]!.status).toBe("CAPTURED");
    expect(done.shipments[0]!.status).toBe("DELIVERED");
    expect(done.statusHistory.map((h) => h.toStatus)).toEqual([
      "PENDING",
      "CONFIRMED",
      "PROCESSING",
      "SHIPPED",
      "DELIVERED",
    ]);
    expect(await db.adminAuditLog.count({ where: { entityId: id } })).toBeGreaterThanOrEqual(3);
    expect(
      await eventually(
        async () =>
          (await db.outboundEmail.count({
            where: { template: { in: ["order-shipped", "order-delivered"] } },
          })) === 2,
      ),
    ).toBe(true);
  });

  it("rejects invalid transitions and manual confirmation of unpaid online orders", async () => {
    const { cookie } = await createAdmin();
    const order = await codOrder();
    const res = await statusRoute.POST(
      post(`/api/admin/orders/${order.id}/status`, cookie, { status: "DELIVERED" }),
      params({ id: order.id }),
    );
    expect(res.status).toBe(409);
  });

  it("records a manual refund for a delivered COD order and filters orders", async () => {
    const { cookie } = await createAdmin();
    const order = await codOrder();
    await db.order.update({
      where: { id: order.id },
      data: { status: "DELIVERED", paymentStatus: "PAID" },
    });
    const res = await refundRoute.POST(
      post(`/api/admin/orders/${order.id}/refunds`, cookie, {
        amountPaise: 50_000,
        reason: "Damaged in transit",
      }),
      params({ id: order.id }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ method: "MANUAL", status: "PROCESSED" });
    const list = await ordersRoute.GET(
      apiRequest(`/api/admin/orders?payment=PARTIALLY_REFUNDED&q=${order.orderNumber}`, { cookie }),
      undefined,
    );
    expect((await list.json()).data.orders).toHaveLength(1);
  });
});

describe("GST invoices", () => {
  it("issues consecutive FY invoice numbers with an intra-state CGST/SGST snapshot", async () => {
    await db.storeSettings.update({
      where: { id: "default" },
      data: { gstEnabled: true, gstin: "29AAGCB7383J1Z4", stateCode: "KA" },
    });
    const { cookie } = await createAdmin();
    const a = await codOrder();
    const b = await codOrder({ state: "MH" });
    const ra = await invoiceRoute.POST(
      post(`/api/admin/orders/${a.id}/invoice`, cookie),
      params({ id: a.id }),
    );
    const rb = await invoiceRoute.POST(
      post(`/api/admin/orders/${b.id}/invoice`, cookie),
      params({ id: b.id }),
    );
    const na = (await ra.json()).data.invoiceNumber as string;
    const nb = (await rb.json()).data.invoiceNumber as string;
    expect(na).toMatch(/^INV\d{4}\/00001$/);
    expect(nb).toMatch(/\/00002$/);
    expect(na.length).toBeLessThanOrEqual(16);
    // Idempotent.
    const again = await invoiceRoute.POST(
      post(`/api/admin/orders/${a.id}/invoice`, cookie),
      params({ id: a.id }),
    );
    expect((await again.json()).data.invoiceNumber).toBe(na);

    const ia = (await db.invoice.findUniqueOrThrow({ where: { orderId: a.id } }))
      .snapshot as unknown as InvoiceSnapshot;
    expect(ia.documentTitle).toBe("Tax Invoice");
    expect(ia.supplyType).toBe("INTRA_STATE");
    expect(ia.seller.gstin).toBe("29AAGCB7383J1Z4");
    expect(ia.totals.cgstPaise + ia.totals.sgstPaise).toBe(ia.totals.taxPaise);
    expect(ia.totals.taxableValuePaise + ia.totals.taxPaise).toBe(ia.totals.grandTotalPaise);
    const ib = (await db.invoice.findUniqueOrThrow({ where: { orderId: b.id } }))
      .snapshot as unknown as InvoiceSnapshot;
    expect(ib.supplyType).toBe("INTER_STATE");
    expect(ib.totals.igstPaise).toBe(ib.totals.taxPaise);
  });

  it("issues a plain invoice without tax when GST is disabled and refuses unconfirmed orders", async () => {
    const { cookie } = await createAdmin();
    const a = await codOrder();
    await invoiceRoute.POST(
      post(`/api/admin/orders/${a.id}/invoice`, cookie),
      params({ id: a.id }),
    );
    const snap = (await db.invoice.findUniqueOrThrow({ where: { orderId: a.id } }))
      .snapshot as unknown as InvoiceSnapshot;
    expect(snap.documentTitle).toBe("Invoice");
    expect(snap.totals.taxPaise).toBe(0);
    await db.order.update({ where: { id: a.id }, data: { status: "PENDING" } });
    const b = await codOrder();
    await db.order.update({ where: { id: b.id }, data: { status: "CANCELLED" } });
    expect(
      (
        await invoiceRoute.POST(
          post(`/api/admin/orders/${b.id}/invoice`, cookie),
          params({ id: b.id }),
        )
      ).status,
    ).toBe(409);
  });
});

describe("customer management", () => {
  it("lists customers and disabling revokes sessions and blocks sign-in", async () => {
    const { cookie } = await createAdmin();
    const c = await registerCustomer("victim@example.com");
    const list = await customersRoute.GET(
      apiRequest("/api/admin/customers?q=victim", { cookie }),
      undefined,
    );
    expect((await list.json()).data.customers).toHaveLength(1);
    const res = await customerRoute.PATCH(
      apiRequest(`/api/admin/customers/${c.user.id}`, {
        method: "PATCH",
        cookie,
        body: { status: "DISABLED" },
      }),
      params({ id: c.user.id }),
    );
    expect(res.status).toBe(200);
    expect(await getUserFromHeaders(new Headers({ cookie: c.cookie }))).toBeNull();
    expect((await signIn("victim@example.com")).res.ok).toBe(false);
    await customerRoute.PATCH(
      apiRequest(`/api/admin/customers/${c.user.id}`, {
        method: "PATCH",
        cookie,
        body: { status: "ACTIVE" },
      }),
      params({ id: c.user.id }),
    );
    expect((await signIn("victim@example.com")).res.ok).toBe(true);
  });

  it("cannot be used to disable administrators", async () => {
    const { cookie, user } = await createAdmin();
    const res = await customerRoute.PATCH(
      apiRequest(`/api/admin/customers/${user.id}`, {
        method: "PATCH",
        cookie,
        body: { status: "DISABLED" },
      }),
      params({ id: user.id }),
    );
    expect(res.status).toBe(404);
  });
});

describe("coupon management", () => {
  it("creates, validates, updates and deactivates used coupons", async () => {
    const { cookie } = await createAdmin();
    const bad = await couponsRoute.POST(
      post("/api/admin/coupons", cookie, { code: "X", type: "PERCENTAGE", value: 20_000 }),
      undefined,
    );
    expect(bad.status).toBe(400);
    const res = await couponsRoute.POST(
      post("/api/admin/coupons", cookie, {
        code: "diwali25",
        type: "PERCENTAGE",
        value: 2500,
        maxDiscountPaise: 100_000,
        minOrderPaise: 200_000,
        usageLimit: 100,
        usageLimitPerUser: 1,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
      undefined,
    );
    expect(res.status).toBe(201);
    const coupon = (await res.json()).data;
    expect(coupon.code).toBe("DIWALI25");
    const dup = await couponsRoute.POST(
      post("/api/admin/coupons", cookie, { code: "DIWALI25", type: "FIXED", value: 100 }),
      undefined,
    );
    expect(dup.status).toBe(409);
    const upd = await couponRoute.PUT(
      apiRequest(`/api/admin/coupons/${coupon.id}`, {
        method: "PUT",
        cookie,
        body: { code: "DIWALI25", type: "FIXED", value: 30_000, isActive: true },
      }),
      params({ id: coupon.id }),
    );
    expect((await upd.json()).data).toMatchObject({
      type: "FIXED",
      value: 30_000,
      maxDiscountPaise: null,
    });
    const order = await codOrder();
    await db.couponUsage.create({
      data: { couponId: coupon.id, orderId: order.id, email: "x@example.com", discountPaise: 1 },
    });
    const del = await couponRoute.DELETE(
      apiRequest(`/api/admin/coupons/${coupon.id}`, { method: "DELETE", cookie }),
      params({ id: coupon.id }),
    );
    expect((await del.json()).data.action).toBe("deactivated");
  });
});

describe("store settings", () => {
  const base = {
    storeName: "Shayvera",
    supportEmail: "help@shayvera.example",
    stateCode: "KA",
    gstEnabled: false,
    pricesIncludeTax: true,
    defaultTaxRateBps: 1800,
    shippingFlatPaise: 4900,
    freeShippingThresholdPaise: 50_000,
    codEnabled: true,
    codFeePaise: 0,
    codMinOrderPaise: 0,
    codMaxOrderPaise: null,
    codBlockedPincodes: ["110001"],
    minOrderPaise: 0,
    orderPrefix: "ORD",
    invoicePrefix: "INV",
    lowStockThreshold: 3,
  };
  it("validates GSTIN checksum and state, then applies settings to pricing", async () => {
    const { cookie } = await createAdmin();
    const put = (body: unknown) =>
      settingsRoute.PUT(
        apiRequest("/api/admin/settings", { method: "PUT", cookie, body }),
        undefined,
      );
    expect((await put({ ...base, gstEnabled: true })).status).toBe(400); // GSTIN required
    expect((await put({ ...base, gstEnabled: true, gstin: "29AAGCB7383J1Z5" })).status).toBe(400); // bad checksum
    expect((await put({ ...base, gstEnabled: true, gstin: "27AAPFU0939F1ZV" })).status).toBe(400); // state mismatch (MH vs KA)
    expect((await put({ ...base, gstEnabled: true, gstin: "29AAGCB7383J1Z4" })).status).toBe(200);
    expect((await put({ ...base, fssaiLicense: "12345" })).status).toBe(400);
    expect((await put({ ...base, fssaiLicense: "10020042000123" })).status).toBe(200);
    expect(
      (await db.storeSettings.findUniqueOrThrow({ where: { id: "default" } })).fssaiLicense,
    ).toBe("10020042000123");
    const p = await makeProduct({ price: 30_000 });
    const cookieCart = await cartWith(p.variants[0]!.id);
    const { json } = await checkout(cookieCart, checkoutBody());
    expect(json.data.orderNumber).toMatch(/^ORD/);
    expect(json.data.totalPaise).toBe(30_000 + 4900); // new flat shipping, COD fee 0
  });
});

describe("dashboard analytics", () => {
  it("reports figures from the database", async () => {
    const { cookie } = await createAdmin();
    const a = await codOrder({ price: 100_000 });
    await codOrder({ price: 50_000 });
    await db.order.update({
      where: { id: a.id },
      data: { status: "DELIVERED", paymentStatus: "PAID" },
    });
    const res = await dashboardRoute.GET(
      apiRequest("/api/admin/dashboard?range=7d", { cookie }),
      undefined,
    );
    const s = (await res.json()).data;
    expect(s.soldOrders).toBe(2);
    expect(s.grossSales).toBe(100_000 + 4900 + 50_000 + 9900 + 4900); // second order is below free-shipping threshold
    expect(s.netRevenue).toBe(100_000 + 4900);
    expect(s.series).toHaveLength(7);
    expect(s.series.reduce((t: number, d: { sales: number }) => t + d.sales, 0)).toBe(s.grossSales);
    expect(s.bestsellers.length).toBeGreaterThan(0);
  });
});
