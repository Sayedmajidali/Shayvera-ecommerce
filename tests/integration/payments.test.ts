import { createHmac, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import { drainJobs, availableStock } from "../helpers/db";
import * as verifyRoute from "@/app/api/payments/razorpay/verify/route";
import * as mockRoute from "@/app/api/payments/mock/complete/route";
import * as webhookRoute from "@/app/api/webhooks/razorpay/route";
import * as payRoute from "@/app/api/orders/[orderNumber]/pay/route";
import * as cancelRoute from "@/app/api/orders/[orderNumber]/cancel/route";
import { resetPaymentGateway } from "@/server/modules/payments/gateway";
import {
  createRefund,
  expireStalePendingOrders,
  reconcileOrderPayments,
} from "@/server/modules/payments/payments";
import { apiRequest, params, createAdmin } from "../helpers/auth";
import { cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { makeProduct } from "../helpers/fixtures";

beforeEach(() => resetPaymentGateway());

async function onlineOrder(stock = 5, price = 120_000) {
  const p = await makeProduct({ stock, price });
  const cookie = await cartWith(p.variants[0]!.id, 1);
  const { res, json } = await checkout(cookie, checkoutBody({ paymentMethod: "RAZORPAY" }));
  expect(res.status).toBe(201);
  expect(json.data.status).toBe("PENDING");
  expect(json.data.payment.gateway).toBe("mock");
  return { product: p, variantId: p.variants[0]!.id, ...json.data } as {
    variantId: string;
    orderId: string;
    orderNumber: string;
    accessToken: string;
    totalPaise: number;
    payment: { razorpayOrderId: string; amountPaise: number };
  };
}

async function simulate(razorpayOrderId: string, outcome: "captured" | "failed") {
  const res = await mockRoute.POST(
    apiRequest("/api/payments/mock/complete", {
      method: "POST",
      body: { razorpayOrderId, outcome },
    }),
    undefined,
  );
  return (await res.json()).data as {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  };
}

const verify = (body: unknown) =>
  verifyRoute.POST(
    apiRequest("/api/payments/razorpay/verify", { method: "POST", body }),
    undefined,
  );

/** Delivers a signed webhook and (by default) lets the job worker process it, as in production. */
async function webhook(
  event: string,
  entity: Record<string, unknown>,
  opts: { eventId?: string; secret?: string; key?: "payment" | "refund"; process?: boolean } = {},
) {
  const raw = JSON.stringify({
    entity: "event",
    event,
    payload: { [opts.key ?? "payment"]: { entity } },
    created_at: Math.floor(Date.now() / 1000),
  });
  const signature = createHmac("sha256", opts.secret ?? "test_webhook_secret")
    .update(raw)
    .digest("hex");
  const res = await webhookRoute.POST(
    new Request("http://localhost:3000/api/webhooks/razorpay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": opts.eventId ?? `evt_${randomUUID()}`,
      },
      body: raw,
    }),
    undefined,
  );
  if (opts.process !== false) await drainJobs();
  return res;
}

const capturedEntity = (o: { razorpayOrderId: string; amount: number; id?: string }) => ({
  id: o.id ?? `pay_live${randomUUID().slice(0, 8)}`,
  entity: "payment",
  order_id: o.razorpayOrderId,
  status: "captured",
  amount: o.amount,
  currency: "INR",
  method: "upi",
});

const order = (orderNumber: string) =>
  db.order.findUniqueOrThrow({
    where: { orderNumber },
    include: { statusHistory: true, payments: true, refunds: true },
  });

describe("Razorpay checkout callback", () => {
  it("confirms the order only after verifying the signature and fetching the payment", async () => {
    const o = await onlineOrder();
    expect(await availableStock(o.variantId)).toBe(4); // reserved
    const cb = await simulate(o.payment.razorpayOrderId, "captured");
    const res = await verify(cb);
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body).toMatchObject({
      outcome: "confirmed",
      status: "CONFIRMED",
      paymentStatus: "PAID",
    });
    const saved = await order(o.orderNumber);
    expect(saved.payments[0]).toMatchObject({
      status: "CAPTURED",
      razorpayPaymentId: cb.razorpay_payment_id,
      instrument: "upi",
    });
    expect(saved.paymentExpiresAt).toBeNull();
    expect(
      await db.paymentEvent.count({
        where: { eventType: "checkout.callback", signatureValid: true },
      }),
    ).toBe(1);
    await drainJobs();
    expect((await db.outboundEmail.count({ where: { template: "order-confirmed" } })) === 1).toBe(
      true,
    );
  });

  it("rejects tampered signatures and does not change the order", async () => {
    const o = await onlineOrder();
    const cb = await simulate(o.payment.razorpayOrderId, "captured");
    const res = await verify({ ...cb, razorpay_signature: "00".repeat(32) });
    expect(res.status).toBe(400);
    expect((await order(o.orderNumber)).status).toBe("PENDING");
    expect(await db.paymentEvent.count({ where: { signatureValid: false } })).toBe(1);
  });

  it("handles duplicate callbacks idempotently", async () => {
    const o = await onlineOrder();
    const cb = await simulate(o.payment.razorpayOrderId, "captured");
    const [a, b] = await Promise.all([verify(cb), verify(cb)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const saved = await order(o.orderNumber);
    expect(saved.statusHistory.filter((h) => h.toStatus === "CONFIRMED")).toHaveLength(1);
    expect(saved.status).toBe("CONFIRMED");
  });

  it("records a failed payment, keeps stock reserved and allows a retry", async () => {
    const o = await onlineOrder();
    const failed = await simulate(o.payment.razorpayOrderId, "failed");
    const res = await verify(failed);
    expect((await res.json()).data.outcome).toBe("failed");
    let saved = await order(o.orderNumber);
    // The order is still payable (stock held) until the window lapses.
    expect(saved).toMatchObject({ status: "PAYMENT_FAILED", paymentStatus: "FAILED" });
    expect(saved.payments[0]!.status).toBe("FAILED");
    expect(await availableStock(o.variantId)).toBe(4);

    // Retry (interrupted / failed checkout) creates a fresh gateway order.
    const retry = await payRoute.POST(
      apiRequest(`/api/orders/${o.orderNumber}/pay`, {
        method: "POST",
        body: { token: o.accessToken },
      }),
      params({ orderNumber: o.orderNumber }),
    );
    expect(retry.status).toBe(200);
    const session = (await retry.json()).data;
    expect(session.razorpayOrderId).not.toBe(o.payment.razorpayOrderId);
    await verify(await simulate(session.razorpayOrderId, "captured"));
    saved = await order(o.orderNumber);
    expect(saved).toMatchObject({ status: "CONFIRMED", paymentStatus: "PAID" });
    expect(saved.payments).toHaveLength(2);
  });

  it("reuses the same gateway order when payment is resumed without a failure", async () => {
    const o = await onlineOrder();
    const res = await payRoute.POST(
      apiRequest(`/api/orders/${o.orderNumber}/pay`, {
        method: "POST",
        body: { token: o.accessToken },
      }),
      params({ orderNumber: o.orderNumber }),
    );
    expect((await res.json()).data.razorpayOrderId).toBe(o.payment.razorpayOrderId);
  });

  it("refuses payment retries for strangers", async () => {
    const o = await onlineOrder();
    const res = await payRoute.POST(
      apiRequest(`/api/orders/${o.orderNumber}/pay`, { method: "POST", body: {} }),
      params({ orderNumber: o.orderNumber }),
    );
    expect(res.status).toBe(404);
  });
});

describe("Razorpay webhooks", () => {
  it("rejects invalid signatures without storing anything", async () => {
    const o = await onlineOrder();
    const res = await webhook(
      "payment.captured",
      capturedEntity({ razorpayOrderId: o.payment.razorpayOrderId, amount: o.totalPaise }),
      { secret: "wrong" },
    );
    expect(res.status).toBe(403);
    expect(await db.paymentEvent.count()).toBe(0);
    expect((await order(o.orderNumber)).status).toBe("PENDING");
  });

  it("confirms on payment.captured and ignores duplicate deliveries", async () => {
    const o = await onlineOrder();
    const entity = capturedEntity({
      razorpayOrderId: o.payment.razorpayOrderId,
      amount: o.totalPaise,
    });
    const first = await webhook("payment.captured", entity, { eventId: "evt_1" });
    expect((await first.json()).duplicate).toBe(false);
    const dup = await webhook("payment.captured", entity, { eventId: "evt_1" });
    expect(dup.status).toBe(200);
    expect((await dup.json()).duplicate).toBe(true);
    const saved = await order(o.orderNumber);
    expect(saved).toMatchObject({ status: "CONFIRMED", paymentStatus: "PAID" });
    expect(saved.statusHistory.filter((h) => h.toStatus === "CONFIRMED")).toHaveLength(1);
    expect(await db.paymentEvent.count({ where: { eventId: "evt_1" } })).toBe(1);
  });

  it("is safe when the webhook and the checkout callback race", async () => {
    const o = await onlineOrder();
    const cb = await simulate(o.payment.razorpayOrderId, "captured");
    const entity = capturedEntity({
      razorpayOrderId: o.payment.razorpayOrderId,
      amount: o.totalPaise,
      id: cb.razorpay_payment_id,
    });
    await Promise.all([
      verify(cb),
      webhook("payment.captured", entity),
      webhook("order.paid", entity),
    ]);
    const saved = await order(o.orderNumber);
    expect(saved.status).toBe("CONFIRMED");
    expect(saved.statusHistory.filter((h) => h.toStatus === "CONFIRMED")).toHaveLength(1);
    expect(saved.refunds).toHaveLength(0);
  });

  it("ignores an out-of-order payment.failed after capture", async () => {
    const o = await onlineOrder();
    const entity = capturedEntity({
      razorpayOrderId: o.payment.razorpayOrderId,
      amount: o.totalPaise,
    });
    await webhook("payment.captured", entity);
    await webhook("payment.failed", {
      ...entity,
      status: "failed",
      error_code: "BAD_REQUEST_ERROR",
    });
    const saved = await order(o.orderNumber);
    expect(saved.paymentStatus).toBe("PAID");
    expect(saved.payments[0]!.status).toBe("CAPTURED");
  });

  it("flags amount mismatches instead of confirming", async () => {
    const o = await onlineOrder();
    await webhook(
      "payment.captured",
      capturedEntity({ razorpayOrderId: o.payment.razorpayOrderId, amount: 100 }),
    );
    const saved = await order(o.orderNumber);
    expect(saved.status).toBe("PENDING");
    expect(saved.requiresAttention).toBe(true);
  });

  it("acknowledges events for unknown orders and unhandled event types", async () => {
    const res = await webhook(
      "payment.captured",
      capturedEntity({ razorpayOrderId: "order_unknown", amount: 100 }),
    );
    expect(res.status).toBe(200);
    expect((await webhook("invoice.paid", { id: "inv_1" }, { key: "payment" })).status).toBe(200);
  });
});

describe("expiry, delayed webhooks and reconciliation", () => {
  it("expires unpaid orders and releases stock", async () => {
    const o = await onlineOrder();
    await db.order.update({
      where: { id: o.orderId },
      data: { paymentExpiresAt: new Date(Date.now() - 1000) },
    });
    const r = await expireStalePendingOrders();
    expect(r.cancelled).toBe(1);
    const saved = await order(o.orderNumber);
    expect(saved.status).toBe("CANCELLED");
    expect(await availableStock(o.variantId)).toBe(5);
    expect(
      await db.inventoryReservation.count({ where: { orderId: o.orderId, status: "RELEASED" } }),
    ).toBe(1);
    expect(
      await db.inventoryReservation.count({ where: { orderId: o.orderId, status: "ACTIVE" } }),
    ).toBe(0);
  });

  it("reinstates an expired order when a delayed capture arrives and stock is still available", async () => {
    const o = await onlineOrder();
    await db.order.update({
      where: { id: o.orderId },
      data: { paymentExpiresAt: new Date(Date.now() - 1000) },
    });
    await expireStalePendingOrders();
    await webhook(
      "payment.captured",
      capturedEntity({ razorpayOrderId: o.payment.razorpayOrderId, amount: o.totalPaise }),
    );
    const saved = await order(o.orderNumber);
    expect(saved).toMatchObject({ status: "CONFIRMED", paymentStatus: "PAID" });
    expect(saved.statusHistory.at(-1)?.note).toContain("Reinstated");
    expect(await availableStock(o.variantId)).toBe(4);
  });

  it("refunds a delayed capture when the stock has been sold in the meantime", async () => {
    const o = await onlineOrder(1);
    await db.order.update({
      where: { id: o.orderId },
      data: { paymentExpiresAt: new Date(Date.now() - 1000) },
    });
    await expireStalePendingOrders();
    // Someone else buys the last unit.
    const cookie = await cartWith(o.variantId, 1);
    expect((await checkout(cookie, checkoutBody())).res.status).toBe(201);

    await webhook(
      "payment.captured",
      capturedEntity({ razorpayOrderId: o.payment.razorpayOrderId, amount: o.totalPaise }),
    );
    const saved = await order(o.orderNumber);
    expect(saved.status).toBe("REFUNDED");
    expect(saved.paymentStatus).toBe("REFUNDED");
    expect(saved.refunds[0]).toMatchObject({
      status: "PROCESSED",
      amountPaise: o.totalPaise,
      method: "RAZORPAY",
    });
    expect(await availableStock(o.variantId)).toBe(0);
  });

  it("recovers an interrupted checkout by reconciling with the gateway", async () => {
    const o = await onlineOrder();
    // The customer paid but closed the tab before the callback ran.
    const cb = await simulate(o.payment.razorpayOrderId, "captured");
    await db.payment.updateMany({
      where: { razorpayOrderId: o.payment.razorpayOrderId },
      data: { razorpayPaymentId: cb.razorpay_payment_id },
    });
    expect(await reconcileOrderPayments(o.orderId)).toBe("paid");
    expect((await order(o.orderNumber)).status).toBe("CONFIRMED");
  });

  it("does not expire an order whose payment was actually captured", async () => {
    const o = await onlineOrder();
    const cb = await simulate(o.payment.razorpayOrderId, "captured");
    await db.payment.updateMany({
      where: { razorpayOrderId: o.payment.razorpayOrderId },
      data: { razorpayPaymentId: cb.razorpay_payment_id },
    });
    await db.order.update({
      where: { id: o.orderId },
      data: { paymentExpiresAt: new Date(Date.now() - 1000) },
    });
    const r = await expireStalePendingOrders();
    expect(r.cancelled).toBe(0);
    expect((await order(o.orderNumber)).status).toBe("CONFIRMED");
  });
});

describe("refunds", () => {
  async function paidOrder() {
    const o = await onlineOrder();
    await verify(await simulate(o.payment.razorpayOrderId, "captured"));
    return o;
  }

  it("issues partial then full refunds and never exceeds the order total", async () => {
    const o = await paidOrder();
    await createRefund({
      orderId: o.orderId,
      amountPaise: 20_000,
      reason: "Damaged item",
      actor: { type: "ADMIN" },
    });
    let saved = await order(o.orderNumber);
    expect(saved).toMatchObject({ paymentStatus: "PARTIALLY_REFUNDED", refundedPaise: 20_000 });
    await expect(
      createRefund({
        orderId: o.orderId,
        amountPaise: o.totalPaise,
        reason: "too much",
        actor: { type: "ADMIN" },
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await createRefund({
      orderId: o.orderId,
      amountPaise: o.totalPaise - 20_000,
      reason: "Rest",
      actor: { type: "ADMIN" },
    });
    saved = await order(o.orderNumber);
    expect(saved).toMatchObject({ paymentStatus: "REFUNDED", refundedPaise: o.totalPaise });
  });

  it("prevents concurrent refunds from over-refunding", async () => {
    const o = await paidOrder();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        createRefund({
          orderId: o.orderId,
          amountPaise: Math.floor(o.totalPaise / 2),
          reason: "race",
          actor: { type: "ADMIN" },
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect((await order(o.orderNumber)).refundedPaise).toBeLessThanOrEqual(o.totalPaise);
  });

  it("refunds in full once staff approve a customer's cancellation of a paid order", async () => {
    const o = await paidOrder();
    const res = await cancelRoute.POST(
      apiRequest(`/api/orders/${o.orderNumber}/cancel`, {
        method: "POST",
        body: { token: o.accessToken },
      }),
      params({ orderNumber: o.orderNumber }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.outcome).toBe("requested");
    expect((await order(o.orderNumber)).status).toBe("CANCELLATION_REQUESTED");
    expect(await db.refund.count()).toBe(0); // nothing refunded before a decision
    const { approveRequest } = await import("@/server/modules/orders/requests");
    const { user } = await createAdmin();
    const request = await db.orderRequest.findFirstOrThrow({ where: { orderId: o.orderId } });
    await approveRequest(request.id, null, { id: user.id });
    const saved = await order(o.orderNumber);
    expect(saved.status).toBe("REFUNDED");
    expect(saved.statusHistory.map((h) => h.toStatus).slice(-3)).toEqual([
      "CANCELLED",
      "REFUND_PENDING",
      "REFUNDED",
    ]);
    expect(saved.refunds[0]!.status).toBe("PROCESSED");
    expect(await availableStock(o.variantId)).toBe(5);
  });

  it("settles pending refunds from refund webhooks", async () => {
    const o = await paidOrder();
    await db.order.update({ where: { id: o.orderId }, data: { refundedPaise: 10_000 } });
    await db.refund.create({
      data: {
        orderId: o.orderId,
        amountPaise: 10_000,
        reason: "test",
        method: "RAZORPAY",
        status: "PENDING",
        razorpayRefundId: "rfnd_abc",
      },
    });
    await webhook(
      "refund.processed",
      { id: "rfnd_abc", entity: "refund", amount: 10_000, status: "processed" },
      { key: "refund" },
    );
    expect(
      (await db.refund.findUniqueOrThrow({ where: { razorpayRefundId: "rfnd_abc" } })).status,
    ).toBe("PROCESSED");
    expect((await order(o.orderNumber)).paymentStatus).toBe("PARTIALLY_REFUNDED");
  });

  it("records a refund made in the Razorpay dashboard (partial, then the rest)", async () => {
    const o = await paidOrder();
    const pay = await db.payment.findFirstOrThrow({
      where: { orderId: o.orderId, status: "CAPTURED" },
    });
    const refundEntity = (id: string, amount: number) => ({
      id,
      entity: "refund",
      amount,
      status: "processed",
      payment_id: pay.razorpayPaymentId,
      notes: [],
    });
    await webhook("refund.processed", refundEntity("rfnd_dash1", 20_000), { key: "refund" });
    let saved = await order(o.orderNumber);
    expect(saved).toMatchObject({ paymentStatus: "PARTIALLY_REFUNDED", refundedPaise: 20_000 });
    expect(saved.refunds[0]).toMatchObject({
      status: "PROCESSED",
      method: "RAZORPAY",
      reason: "Refunded in the Razorpay dashboard",
    });
    // Redelivery of the same event changes nothing.
    await webhook("refund.processed", refundEntity("rfnd_dash1", 20_000), { key: "refund" });
    expect((await order(o.orderNumber)).refundedPaise).toBe(20_000);

    await webhook("refund.processed", refundEntity("rfnd_dash2", o.totalPaise - 20_000), {
      key: "refund",
    });
    saved = await order(o.orderNumber);
    expect(saved).toMatchObject({ paymentStatus: "REFUNDED", refundedPaise: o.totalPaise });
    // Still CONFIRMED (not shipped) → flagged so staff do not ship a refunded order.
    expect(saved.requiresAttention).toBe(true);
    expect(saved.attentionReason).toContain("Razorpay dashboard");
    expect(await db.outboundEmail.count({ where: { template: "order-refunded" } })).toBe(2);
  });

  it("matches its own refund by notes.refundId when the webhook arrives first", async () => {
    const o = await paidOrder();
    await db.order.update({ where: { id: o.orderId }, data: { refundedPaise: 5_000 } });
    const ours = await db.refund.create({
      data: {
        orderId: o.orderId,
        amountPaise: 5_000,
        reason: "x",
        method: "RAZORPAY",
        status: "PENDING",
      },
    });
    await webhook(
      "refund.processed",
      { id: "rfnd_race", entity: "refund", amount: 5_000, notes: { refundId: ours.id } },
      { key: "refund" },
    );
    const after = await db.refund.findUniqueOrThrow({ where: { id: ours.id } });
    expect(after).toMatchObject({ status: "PROCESSED", razorpayRefundId: "rfnd_race" });
    expect(await db.refund.count()).toBe(1);
    expect((await order(o.orderNumber)).refundedPaise).toBe(5_000);
  });

  it("flags, instead of recording, a dashboard refund larger than what is refundable", async () => {
    const o = await paidOrder();
    const pay = await db.payment.findFirstOrThrow({ where: { orderId: o.orderId } });
    await webhook(
      "refund.processed",
      {
        id: "rfnd_big",
        entity: "refund",
        amount: o.totalPaise + 100,
        payment_id: pay.razorpayPaymentId,
      },
      { key: "refund" },
    );
    const saved = await order(o.orderNumber);
    expect(saved.refundedPaise).toBe(0);
    expect(saved.requiresAttention).toBe(true);
    expect(await db.refund.count()).toBe(0);
  });

  it("refuses refunds for unpaid orders", async () => {
    const o = await onlineOrder();
    await expect(
      createRefund({ orderId: o.orderId, amountPaise: 100, reason: "x", actor: { type: "ADMIN" } }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
