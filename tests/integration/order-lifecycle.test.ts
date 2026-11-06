import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import * as cancelRoute from "@/app/api/orders/[orderNumber]/cancel/route";
import * as returnRoute from "@/app/api/orders/[orderNumber]/return/route";
import * as withdrawRoute from "@/app/api/orders/[orderNumber]/requests/[id]/withdraw/route";
import * as approveRoute from "@/app/api/admin/requests/[id]/approve/route";
import * as rejectRoute from "@/app/api/admin/requests/[id]/reject/route";
import * as receiveRoute from "@/app/api/admin/requests/[id]/receive/route";
import * as statusRoute from "@/app/api/admin/orders/[id]/status/route";
import * as refundRoute from "@/app/api/admin/orders/[id]/refunds/route";
import { transitionOrder } from "@/server/modules/orders/orders";
import { apiRequest, createAdmin, params } from "../helpers/auth";
import { cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { drainJobs } from "../helpers/db";
import { makeProduct } from "../helpers/fixtures";

type Status = Parameters<typeof transitionOrder>[1]["to"];
const move = (orderId: string, ...steps: Status[]) =>
  steps.reduce(
    (p, to) =>
      p.then(() =>
        db.$transaction((tx) => transitionOrder(tx, { orderId, to, actor: { type: "SYSTEM" } })),
      ),
    Promise.resolve() as Promise<unknown>,
  );
const inv = (variantId: string) => db.inventory.findUniqueOrThrow({ where: { variantId } });
const order = (id: string) =>
  db.order.findUniqueOrThrow({
    where: { id },
    include: { statusHistory: { orderBy: { createdAt: "asc" } }, items: true },
  });

async function codOrder(qty = 2, stock = 10) {
  const p = await makeProduct({ stock, price: 40_000 });
  const variantId = p.variants[0]!.id;
  const { json } = await checkout(await cartWith(variantId, qty), checkoutBody());
  return {
    variantId,
    productId: p.id,
    orderId: json.data.orderId as string,
    orderNumber: json.data.orderNumber as string,
    token: json.data.accessToken as string,
  };
}

const customer = (
  path: string,
  body: unknown,
  ctx: object,
  route: { POST: (r: Request, c: never) => Promise<Response> },
) => route.POST(apiRequest(path, { method: "POST", body }), ctx as never);
const staff = (
  path: string,
  cookie: string,
  body: unknown,
  id: string,
  route: { POST: (r: Request, c: never) => Promise<Response> },
) => route.POST(apiRequest(path, { method: "POST", cookie, body }), params({ id }) as never);

describe("fulfilment path", () => {
  it("deducts stock at READY_TO_SHIP (not again at SHIPPED) and finishes with COD paid", async () => {
    const o = await codOrder(2);
    await move(o.orderId, "PROCESSING");
    expect(await inv(o.variantId)).toMatchObject({ quantityOnHand: 10, quantityReserved: 2 });
    await move(o.orderId, "READY_TO_SHIP");
    expect(await inv(o.variantId)).toMatchObject({ quantityOnHand: 8, quantityReserved: 0 });
    await move(
      o.orderId,
      "SHIPPED",
      "OUT_FOR_DELIVERY",
      "SHIPPED",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    );
    expect(await inv(o.variantId)).toMatchObject({ quantityOnHand: 8, quantityReserved: 0 });
    const saved = await order(o.orderId);
    expect(saved).toMatchObject({ status: "DELIVERED", paymentStatus: "PAID" });
    await drainJobs();
    const sent = await db.outboundEmail.findMany({
      where: { to: "buyer@example.com" },
      select: { template: true },
    });
    const count = (t: string) => sent.filter((e) => e.template === t).length;
    // A failed delivery attempt (back to SHIPPED) does not resend "shipped".
    expect([
      count("order-shipped"),
      count("order-out_for_delivery"),
      count("order-delivered"),
    ]).toEqual([1, 2, 1]);
  });
});

describe("cancellation requests", () => {
  it("unpaid online orders cancel immediately; accepted orders become a request", async () => {
    const p = await makeProduct({ stock: 5 });
    const online = await checkout(
      await cartWith(p.variants[0]!.id),
      checkoutBody({ paymentMethod: "RAZORPAY" }),
    );
    const n = online.json.data.orderNumber;
    const res = await customer(
      `/api/orders/${n}/cancel`,
      { token: online.json.data.accessToken },
      params({ orderNumber: n }),
      cancelRoute,
    );
    expect((await res.json()).data).toMatchObject({ outcome: "cancelled", status: "CANCELLED" });

    const o = await codOrder();
    const req = await customer(
      `/api/orders/${o.orderNumber}/cancel`,
      { token: o.token, reason: "Address changed" },
      params({ orderNumber: o.orderNumber }),
      cancelRoute,
    );
    expect((await req.json()).data).toMatchObject({
      outcome: "requested",
      status: "CANCELLATION_REQUESTED",
    });
  });

  it("approving a packed order's cancellation puts the deducted units back", async () => {
    const { cookie } = await createAdmin();
    const o = await codOrder(3);
    await move(o.orderId, "READY_TO_SHIP");
    expect(await inv(o.variantId)).toMatchObject({ quantityOnHand: 7, quantityReserved: 0 });
    await customer(
      `/api/orders/${o.orderNumber}/cancel`,
      { token: o.token },
      params({ orderNumber: o.orderNumber }),
      cancelRoute,
    );
    const r = await db.orderRequest.findFirstOrThrow({ where: { orderId: o.orderId } });
    const res = await staff(`/api/admin/requests/${r.id}/approve`, cookie, {}, r.id, approveRoute);
    expect((await res.json()).data).toMatchObject({ outcome: "cancelled", refundStarted: false });
    expect(await inv(o.variantId)).toMatchObject({ quantityOnHand: 10, quantityReserved: 0 });
    expect(
      await db.inventoryTransaction.count({
        where: { orderId: o.orderId, reason: "ORDER_CANCELLED", delta: 3 },
      }),
    ).toBe(1);
    expect((await db.orderRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
      "COMPLETED",
    );
  });

  it("rejecting returns the order to its previous status without repeating first-time effects", async () => {
    const { cookie } = await createAdmin();
    const o = await codOrder(1);
    await move(o.orderId, "PROCESSING");
    const sales = (await db.product.findUniqueOrThrow({ where: { id: o.productId } })).salesCount;
    await customer(
      `/api/orders/${o.orderNumber}/cancel`,
      { token: o.token },
      params({ orderNumber: o.orderNumber }),
      cancelRoute,
    );
    const r = await db.orderRequest.findFirstOrThrow({ where: { orderId: o.orderId } });
    const bad = await staff(
      `/api/admin/requests/${r.id}/reject`,
      cookie,
      { note: "" },
      r.id,
      rejectRoute,
    );
    expect(bad.status).toBe(400); // a reason is required
    await staff(
      `/api/admin/requests/${r.id}/reject`,
      cookie,
      { note: "Already packed and leaving today" },
      r.id,
      rejectRoute,
    );
    const saved = await order(o.orderId);
    expect(saved.status).toBe("PROCESSING");
    expect((await db.product.findUniqueOrThrow({ where: { id: o.productId } })).salesCount).toBe(
      sales,
    );
    await drainJobs();
    expect(await db.outboundEmail.count({ where: { template: "order-confirmed" } })).toBe(1);
    expect(await db.outboundEmail.count({ where: { template: "order-request_rejected" } })).toBe(1);
    // Deciding twice is refused.
    const again = await staff(
      `/api/admin/requests/${r.id}/approve`,
      cookie,
      {},
      r.id,
      approveRoute,
    );
    expect(again.status).toBe(409);
  });

  it("customers can withdraw a pending request; only one open request per order", async () => {
    const o = await codOrder();
    const ctx = params({ orderNumber: o.orderNumber });
    const results = await Promise.all([
      customer(`/api/orders/${o.orderNumber}/cancel`, { token: o.token }, ctx, cancelRoute),
      customer(`/api/orders/${o.orderNumber}/cancel`, { token: o.token }, ctx, cancelRoute),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.orderRequest.count({ where: { orderId: o.orderId } })).toBe(1);
    const r = await db.orderRequest.findFirstOrThrow({ where: { orderId: o.orderId } });
    const res = await withdrawRoute.POST(
      apiRequest(`/api/orders/${o.orderNumber}/requests/${r.id}/withdraw`, {
        method: "POST",
        body: { token: o.token },
      }),
      params({ orderNumber: o.orderNumber, id: r.id }),
    );
    expect(res.status).toBe(200);
    expect((await order(o.orderId)).status).toBe("CONFIRMED");
    expect((await db.orderRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
      "WITHDRAWN",
    );
  });

  it("is not possible once the parcel has left, and blocks staff status changes while open", async () => {
    const { cookie } = await createAdmin();
    const shipped = await codOrder();
    await move(shipped.orderId, "SHIPPED");
    const late = await customer(
      `/api/orders/${shipped.orderNumber}/cancel`,
      { token: shipped.token },
      params({ orderNumber: shipped.orderNumber }),
      cancelRoute,
    );
    expect(late.status).toBe(409);

    const o = await codOrder();
    await customer(
      `/api/orders/${o.orderNumber}/cancel`,
      { token: o.token },
      params({ orderNumber: o.orderNumber }),
      cancelRoute,
    );
    const blocked = await statusRoute.POST(
      apiRequest(`/api/admin/orders/${o.orderId}/status`, {
        method: "POST",
        cookie,
        body: { status: "PROCESSING" },
      }),
      params({ id: o.orderId }),
    );
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.message).toMatch(/open request/);
  });

  it("support staff cannot approve a cancellation that would refund a paid order", async () => {
    const support = await createAdmin("support@test.local");
    await db.user.update({ where: { id: support.user.id }, data: { adminRoleId: "role_support" } });
    const o = await codOrder();
    await db.order.update({
      where: { id: o.orderId },
      data: { paymentMethod: "RAZORPAY", paymentStatus: "PAID" },
    });
    await customer(
      `/api/orders/${o.orderNumber}/cancel`,
      { token: o.token },
      params({ orderNumber: o.orderNumber }),
      cancelRoute,
    );
    const r = await db.orderRequest.findFirstOrThrow({ where: { orderId: o.orderId } });
    const res = await staff(
      `/api/admin/requests/${r.id}/approve`,
      support.cookie,
      {},
      r.id,
      approveRoute,
    );
    expect(res.status).toBe(403);
    expect((await order(o.orderId)).status).toBe("CANCELLATION_REQUESTED");
  });
});

describe("returns", () => {
  async function delivered(qty = 2) {
    const o = await codOrder(qty);
    await move(o.orderId, "READY_TO_SHIP", "SHIPPED", "DELIVERED");
    const saved = await order(o.orderId);
    return { ...o, itemId: saved.items[0]!.id, deliveredAt: saved.deliveredAt! };
  }
  const ask = (o: { orderNumber: string; token: string }, body: object) =>
    customer(
      `/api/orders/${o.orderNumber}/return`,
      { token: o.token, ...body },
      params({ orderNumber: o.orderNumber }),
      returnRoute,
    );

  it("request → approve → receive with partial restock → refund", async () => {
    const { cookie } = await createAdmin();
    const o = await delivered(2);
    expect(
      (await ask(o, { reason: "no", lines: [{ orderItemId: o.itemId, quantity: 1 }] })).status,
    ).toBe(400);
    expect(
      (
        await ask(o, {
          reason: "Pack arrived torn",
          lines: [{ orderItemId: o.itemId, quantity: 3 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await ask(o, { reason: "Pack arrived torn", lines: [{ orderItemId: "nope", quantity: 1 }] }))
        .status,
    ).toBe(400);
    const ok = await ask(o, {
      reason: "Pack arrived torn",
      lines: [{ orderItemId: o.itemId, quantity: 2 }],
    });
    expect(ok.status).toBe(201);
    expect((await order(o.orderId)).status).toBe("RETURN_REQUESTED");

    const r = await db.orderRequest.findFirstOrThrow({ where: { orderId: o.orderId } });
    await staff(
      `/api/admin/requests/${r.id}/approve`,
      cookie,
      { note: "Courier will collect" },
      r.id,
      approveRoute,
    );
    expect((await db.orderRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
      "APPROVED",
    );
    expect((await order(o.orderId)).status).toBe("RETURN_REQUESTED");

    const tooMany = await staff(
      `/api/admin/requests/${r.id}/receive`,
      cookie,
      { lines: [{ orderItemId: o.itemId, receivedQuantity: 2, restockQuantity: 3 }] },
      r.id,
      receiveRoute,
    );
    expect(tooMany.status).toBe(400);
    const before = await inv(o.variantId);
    const received = await staff(
      `/api/admin/requests/${r.id}/receive`,
      cookie,
      {
        lines: [{ orderItemId: o.itemId, receivedQuantity: 2, restockQuantity: 1 }],
        note: "One pouch torn",
      },
      r.id,
      receiveRoute,
    );
    expect(received.status).toBe(200);
    expect((await inv(o.variantId)).quantityOnHand).toBe(before.quantityOnHand + 1);
    expect(
      await db.inventoryTransaction.count({
        where: { orderId: o.orderId, reason: "RETURN", delta: 1 },
      }),
    ).toBe(1);
    expect((await order(o.orderId)).status).toBe("RETURNED");

    const total = (await order(o.orderId)).totalPaise;
    const refund = await refundRoute.POST(
      apiRequest(`/api/admin/orders/${o.orderId}/refunds`, {
        method: "POST",
        cookie,
        body: { amountPaise: total, reason: "Damaged in transit" },
      }),
      params({ id: o.orderId }),
    );
    expect(refund.status).toBe(201);
    const saved = await order(o.orderId);
    expect(saved.status).toBe("REFUNDED");
    expect(saved.statusHistory.map((h) => h.toStatus).slice(-3)).toEqual([
      "RETURNED",
      "REFUND_PENDING",
      "REFUNDED",
    ]);
    await drainJobs();
    for (const t of [
      "order-return_requested",
      "order-return_approved",
      "order-returned",
      "order-refunded",
    ])
      expect(await db.outboundEmail.count({ where: { template: t } }), t).toBe(1);
  });

  it("rejecting a return keeps the original delivery time (window not reset)", async () => {
    const { cookie } = await createAdmin();
    const o = await delivered(1);
    await ask(o, { reason: "Not as expected", lines: [{ orderItemId: o.itemId, quantity: 1 }] });
    const r = await db.orderRequest.findFirstOrThrow({ where: { orderId: o.orderId } });
    await staff(
      `/api/admin/requests/${r.id}/reject`,
      cookie,
      { note: "Opened food cannot be returned" },
      r.id,
      rejectRoute,
    );
    const saved = await order(o.orderId);
    expect(saved.status).toBe("DELIVERED");
    expect(saved.deliveredAt?.getTime()).toBe(o.deliveredAt.getTime());
  });

  it("closes after the return window and restocking needs inventory permission", async () => {
    const o = await delivered(1);
    await db.order.update({
      where: { id: o.orderId },
      data: { deliveredAt: new Date(Date.now() - 3 * 86_400_000) },
    });
    const late = await ask(o, {
      reason: "Pack arrived torn",
      lines: [{ orderItemId: o.itemId, quantity: 1 }],
    });
    expect(late.status).toBe(422);

    await db.storeSettings.update({ where: { id: "default" }, data: { returnWindowDays: 7 } });
    expect(
      (
        await ask(o, {
          reason: "Pack arrived torn",
          lines: [{ orderItemId: o.itemId, quantity: 1 }],
        })
      ).status,
    ).toBe(201);
    const support = await createAdmin("support@test.local");
    await db.user.update({ where: { id: support.user.id }, data: { adminRoleId: "role_support" } });
    const r = await db.orderRequest.findFirstOrThrow({ where: { orderId: o.orderId } });
    await staff(`/api/admin/requests/${r.id}/approve`, support.cookie, {}, r.id, approveRoute);
    const restock = await staff(
      `/api/admin/requests/${r.id}/receive`,
      support.cookie,
      { lines: [{ orderItemId: o.itemId, receivedQuantity: 1, restockQuantity: 1 }] },
      r.id,
      receiveRoute,
    );
    expect(restock.status).toBe(403);
    const noRestock = await staff(
      `/api/admin/requests/${r.id}/receive`,
      support.cookie,
      { lines: [{ orderItemId: o.itemId, receivedQuantity: 1, restockQuantity: 0 }] },
      r.id,
      receiveRoute,
    );
    expect(noRestock.status).toBe(200);
  });
});

describe("payment failure status", () => {
  it("PAYMENT_FAILED orders still expire and release their stock", async () => {
    const p = await makeProduct({ stock: 5 });
    const { json } = await checkout(
      await cartWith(p.variants[0]!.id),
      checkoutBody({ paymentMethod: "RAZORPAY" }),
    );
    await move(json.data.orderId, "PAYMENT_FAILED");
    await db.order.update({
      where: { id: json.data.orderId },
      data: { paymentExpiresAt: new Date(Date.now() - 1000) },
    });
    const { expireStalePendingOrders } = await import("@/server/modules/payments/payments");
    expect((await expireStalePendingOrders()).cancelled).toBe(1);
    expect((await order(json.data.orderId)).status).toBe("CANCELLED");
    expect(await inv(p.variants[0]!.id)).toMatchObject({ quantityOnHand: 5, quantityReserved: 0 });
  });
});

describe("customer emails on decisions", () => {
  it("an approved cancellation sends the cancellation email", async () => {
    const { cookie } = await createAdmin();
    const o = await codOrder();
    await customer(
      `/api/orders/${o.orderNumber}/cancel`,
      { token: o.token },
      params({ orderNumber: o.orderNumber }),
      cancelRoute,
    );
    const r = await db.orderRequest.findFirstOrThrow({ where: { orderId: o.orderId } });
    await staff(`/api/admin/requests/${r.id}/approve`, cookie, {}, r.id, approveRoute);
    await drainJobs();
    expect(
      await db.outboundEmail.count({ where: { template: "order-cancellation_requested" } }),
    ).toBe(1);
    expect(await db.outboundEmail.count({ where: { template: "order-cancelled" } })).toBe(1);
  });
});
