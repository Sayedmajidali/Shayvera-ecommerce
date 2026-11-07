import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import * as webhookRoute from "@/app/api/webhooks/razorpay/route";
import * as mockRoute from "@/app/api/payments/mock/complete/route";
import * as verifyRoute from "@/app/api/payments/razorpay/verify/route";
import * as refundRoute from "@/app/api/admin/orders/[id]/refunds/route";
import * as retryRoute from "@/app/api/admin/payments/events/[id]/retry/route";
import {
  GatewayError,
  MockGateway,
  resetPaymentGateway,
  setPaymentGateway,
} from "@/server/modules/payments/gateway";
import {
  createRefund,
  reconcilePayments,
  reconcileRefund,
  runCaptureFollowUp,
} from "@/server/modules/payments/payments";
import { apiRequest, createAdmin, params } from "../helpers/auth";
import { cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { drainJobs } from "../helpers/db";
import { makeProduct } from "../helpers/fixtures";

beforeEach(() => resetPaymentGateway());
afterEach(() => {
  delete process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS;
  resetPaymentGateway();
});

async function onlineOrder(price = 120_000) {
  const p = await makeProduct({ stock: 5, price });
  const { json } = await checkout(
    await cartWith(p.variants[0]!.id, 1),
    checkoutBody({ paymentMethod: "RAZORPAY" }),
  );
  return json.data as {
    orderId: string;
    orderNumber: string;
    totalPaise: number;
    payment: { razorpayOrderId: string };
  };
}

async function paidOrder() {
  const o = await onlineOrder();
  const sim = await mockRoute.POST(
    apiRequest("/api/payments/mock/complete", {
      method: "POST",
      body: { razorpayOrderId: o.payment.razorpayOrderId, outcome: "captured" },
    }),
    undefined,
  );
  await verifyRoute.POST(
    apiRequest("/api/payments/razorpay/verify", { method: "POST", body: (await sim.json()).data }),
    undefined,
  );
  return o;
}

function deliver(
  event: string,
  entity: Record<string, unknown>,
  opts: { eventId?: string; secret?: string; raw?: string } = {},
) {
  const raw =
    opts.raw ?? JSON.stringify({ entity: "event", event, payload: { payment: { entity } } });
  const signature = createHmac("sha256", opts.secret ?? "test_webhook_secret")
    .update(raw)
    .digest("hex");
  return webhookRoute.POST(
    new Request("http://localhost:3000/api/webhooks/razorpay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": opts.eventId ?? `evt_${randomUUID()}`,
      },
      body: raw,
    }),
  );
}
const captured = (o: { payment: { razorpayOrderId: string }; totalPaise: number }) => ({
  id: `pay_hard${randomUUID().slice(0, 8)}`,
  entity: "payment",
  order_id: o.payment.razorpayOrderId,
  status: "captured",
  amount: o.totalPaise,
  currency: "INR",
  method: "upi",
});

describe("webhooks are acknowledged fast and processed by the worker", () => {
  it("stores the event and a job, answers 200, and applies it when the job runs", async () => {
    const o = await onlineOrder();
    const started = Date.now();
    const res = await deliver("payment.captured", captured(o), { eventId: "evt_fast" });
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(1000);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe("PENDING");
    const ev = await db.paymentEvent.findUniqueOrThrow({ where: { eventId: "evt_fast" } });
    expect(ev.processedAt).toBeNull();
    expect(
      await db.job.findUniqueOrThrow({ where: { dedupeKey: `rzp-event:${ev.id}` } }),
    ).toMatchObject({
      type: "payments.webhook",
      status: "QUEUED",
    });

    await drainJobs();
    expect((await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe(
      "CONFIRMED",
    );
    expect(
      (await db.paymentEvent.findUniqueOrThrow({ where: { id: ev.id } })).processedAt,
    ).not.toBeNull();
  });

  it("concurrent deliveries of one event store one row and one job", async () => {
    const o = await onlineOrder();
    const entity = captured(o);
    const results = await Promise.all(
      [1, 2, 3].map(() => deliver("payment.captured", entity, { eventId: "evt_same" })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await db.paymentEvent.count({ where: { eventId: "evt_same" } })).toBe(1);
    expect(await db.job.count({ where: { type: "payments.webhook" } })).toBe(1);
  });

  it("a redelivered event whose job died gets processed again; staff can also retry it", async () => {
    const o = await onlineOrder();
    await deliver("payment.captured", captured(o), { eventId: "evt_dead" });
    const ev = await db.paymentEvent.findUniqueOrThrow({ where: { eventId: "evt_dead" } });
    // Simulate exhausted retries.
    await db.job.update({
      where: { dedupeKey: `rzp-event:${ev.id}` },
      data: { status: "DEAD", attempts: 8 },
    });
    const again = await deliver("payment.captured", captured(o), { eventId: "evt_dead" });
    expect((await again.json()).duplicate).toBe(true);
    await drainJobs();
    expect((await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe(
      "CONFIRMED",
    );

    const o2 = await onlineOrder();
    await deliver("payment.captured", captured(o2), { eventId: "evt_dead2" });
    const ev2 = await db.paymentEvent.findUniqueOrThrow({ where: { eventId: "evt_dead2" } });
    await db.job.update({ where: { dedupeKey: `rzp-event:${ev2.id}` }, data: { status: "DEAD" } });
    const { cookie } = await createAdmin();
    const res = await retryRoute.POST(
      apiRequest(`/api/admin/payments/events/${ev2.id}/retry`, {
        method: "POST",
        cookie,
        body: {},
      }),
      params({ id: ev2.id }),
    );
    expect(res.status).toBe(200);
    await drainJobs();
    expect((await db.order.findUniqueOrThrow({ where: { id: o2.orderId } })).status).toBe(
      "CONFIRMED",
    );
    const twice = await retryRoute.POST(
      apiRequest(`/api/admin/payments/events/${ev2.id}/retry`, {
        method: "POST",
        cookie,
        body: {},
      }),
      params({ id: ev2.id }),
    );
    expect(twice.status).toBe(409); // already processed
  });

  it("rejects bad signatures and malformed payloads without storing anything", async () => {
    const o = await onlineOrder();
    expect((await deliver("payment.captured", captured(o), { secret: "wrong" })).status).toBe(403);
    expect((await deliver("x", {}, { raw: "{not json" })).status).toBe(400);
    expect((await deliver("x", {}, { raw: JSON.stringify({ event: "x" }) })).status).toBe(400);
    expect(await db.paymentEvent.count()).toBe(0);
  });

  it("accepts the previous secret only while it is configured (rotation)", async () => {
    const o = await onlineOrder();
    expect((await deliver("payment.captured", captured(o), { secret: "old_secret" })).status).toBe(
      403,
    );
    process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS = "old_secret";
    expect((await deliver("payment.captured", captured(o), { secret: "old_secret" })).status).toBe(
      200,
    );
    expect(
      (await deliver("payment.captured", captured(o), { secret: "test_webhook_secret" })).status,
    ).toBe(200);
  });
});

/** A mock gateway whose refund call fails the way a real network might. */
class FlakyRefundGateway extends MockGateway {
  mode: "timeout-after-success" | "timeout-before" | "rejected" | "ok" = "ok";
  calls = 0;
  constructor() {
    super("rzp_test_mockkey000001", "test_key_secret");
  }
  override async refund(p: {
    paymentId: string;
    amountPaise: number;
    notes?: Record<string, string>;
  }) {
    this.calls++;
    if (this.mode === "rejected")
      throw new GatewayError("Razorpay: The amount is invalid", true, "BAD_REQUEST_ERROR");
    if (this.mode === "timeout-before")
      throw new GatewayError("The payment provider is unavailable.", false);
    const r = await super.refund(p);
    if (this.mode === "timeout-after-success")
      throw new GatewayError("The payment provider is unavailable.", false);
    return r;
  }
}

describe("refunds are never issued twice", () => {
  const actor = { type: "ADMIN" as const };

  it("a timeout after Razorpay created the refund is settled from Razorpay's records", async () => {
    const o = await paidOrder();
    const gw = new FlakyRefundGateway();
    setPaymentGateway(gw);
    gw.mode = "timeout-after-success";
    const r = await createRefund({
      orderId: o.orderId,
      amountPaise: o.totalPaise,
      reason: "Cancelled",
      actor,
    });
    expect(r.status).toBe("PENDING");
    expect((await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).refundedPaise).toBe(
      o.totalPaise,
    ); // still reserved
    expect(await db.job.count({ where: { type: "payments.reconcile-refund" } })).toBe(1);

    // A second refund cannot slip in while the first is unresolved.
    await expect(
      createRefund({ orderId: o.orderId, amountPaise: 100, reason: "again", actor }),
    ).rejects.toThrow(/exceeds/);
    expect(await reconcileRefund(r.id)).toBe("processed");
    const saved = await db.order.findUniqueOrThrow({
      where: { id: o.orderId },
      include: { refunds: true },
    });
    expect(saved.refunds[0]).toMatchObject({ status: "PROCESSED" });
    expect(saved.refunds[0]!.razorpayRefundId).toMatch(/^rfnd_mock/);
    expect(gw.calls).toBe(1);
  });

  it("a timeout before anything was created is released only after a grace period", async () => {
    const o = await paidOrder();
    const gw = new FlakyRefundGateway();
    setPaymentGateway(gw);
    gw.mode = "timeout-before";
    const r = await createRefund({
      orderId: o.orderId,
      amountPaise: 50_000,
      reason: "Damaged",
      actor,
    });
    expect(await reconcileRefund(r.id)).toBe("pending");
    await db.refund.update({
      where: { id: r.id },
      data: { createdAt: new Date(Date.now() - 11 * 60_000) },
    });
    expect(await reconcileRefund(r.id)).toBe("failed");
    expect((await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).refundedPaise).toBe(0);
    gw.mode = "ok";
    const second = await createRefund({
      orderId: o.orderId,
      amountPaise: 50_000,
      reason: "Damaged",
      actor,
    });
    expect(second.status).toBe("PROCESSED");
  });

  it("a definite rejection fails immediately, releases the amount and tells the admin", async () => {
    const o = await paidOrder();
    const gw = new FlakyRefundGateway();
    setPaymentGateway(gw);
    gw.mode = "rejected";
    const { cookie } = await createAdmin();
    const res = await refundRoute.POST(
      apiRequest(`/api/admin/orders/${o.orderId}/refunds`, {
        method: "POST",
        cookie,
        body: { amountPaise: 10_000, reason: "Goodwill" },
      }),
      params({ id: o.orderId }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toMatch(/amount is invalid/);
    const saved = await db.order.findUniqueOrThrow({
      where: { id: o.orderId },
      include: { refunds: true },
    });
    expect(saved.refundedPaise).toBe(0);
    expect(saved.refunds[0]).toMatchObject({ status: "FAILED" });
  });

  it("re-running a duplicate-payment refund job does not refund twice", async () => {
    const o = await paidOrder();
    const gw = new FlakyRefundGateway();
    setPaymentGateway(gw);
    const dup = await db.payment.create({
      data: {
        orderId: o.orderId,
        method: "RAZORPAY",
        status: "CAPTURED",
        amountPaise: o.totalPaise,
        razorpayOrderId: `order_dup${randomUUID().slice(0, 6)}`,
        razorpayPaymentId: `pay_dup${randomUUID().slice(0, 6)}`,
      },
    });
    await runCaptureFollowUp({
      orderId: o.orderId,
      razorpayPaymentId: dup.razorpayPaymentId!,
      needsReinstate: false,
    });
    await runCaptureFollowUp({
      orderId: o.orderId,
      razorpayPaymentId: dup.razorpayPaymentId!,
      needsReinstate: false,
    });
    expect(gw.calls).toBe(1);
    expect(await db.refund.count({ where: { paymentId: dup.id } })).toBe(1);
  });
});

describe("scheduled reconciliation", () => {
  it("confirms an order whose callback and webhook were both lost", async () => {
    const o = await onlineOrder();
    const sim = await mockRoute.POST(
      apiRequest("/api/payments/mock/complete", {
        method: "POST",
        body: { razorpayOrderId: o.payment.razorpayOrderId, outcome: "captured" },
      }),
      undefined,
    );
    const paymentId = (await sim.json()).data.razorpay_payment_id as string;
    // Razorpay knows the payment; we never heard about it.
    await db.payment.update({
      where: { razorpayOrderId: o.payment.razorpayOrderId },
      data: { razorpayPaymentId: paymentId, createdAt: new Date(Date.now() - 20 * 60_000) },
    });
    const r = await reconcilePayments();
    expect(r).toMatchObject({ attemptsChecked: 1, confirmed: 1 });
    expect(await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).toMatchObject({
      status: "CONFIRMED",
      paymentStatus: "PAID",
    });
  });
});
