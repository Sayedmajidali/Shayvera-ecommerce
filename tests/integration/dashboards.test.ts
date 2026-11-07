import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import { getPaymentsDashboard } from "@/server/modules/payments/dashboard";
import { getShipmentsDashboard } from "@/server/modules/shipping/dashboard";
import { cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { makeProduct } from "../helpers/fixtures";

/** Every figure on these dashboards comes from database rows (specification §11). */
async function order(status: "CONFIRMED" | "PENDING" = "CONFIRMED") {
  const p = await makeProduct({ stock: 5, price: 50_000 });
  const { json } = await checkout(await cartWith(p.variants[0]!.id, 1), checkoutBody());
  return db.order.update({ where: { id: json.data.orderId as string }, data: { status } });
}

describe("payments dashboard", () => {
  it("counts captured, failed, pending refunds and unprocessed webhooks from the records", async () => {
    const a = await order();
    const b = await order();
    const c = await order("PENDING");
    await db.order.update({ where: { id: c.id }, data: { paymentMethod: "RAZORPAY" } });
    const now = new Date();
    const lastWeek = new Date(Date.now() - 3 * 86_400_000);
    await db.payment.createMany({
      data: [
        {
          orderId: a.id,
          method: "RAZORPAY",
          status: "CAPTURED",
          amountPaise: 50_000,
          capturedAt: now,
          razorpayPaymentId: "pay_a",
        },
        {
          orderId: b.id,
          method: "RAZORPAY",
          status: "CAPTURED",
          amountPaise: 30_000,
          capturedAt: lastWeek,
          razorpayPaymentId: "pay_b",
        },
        {
          orderId: c.id,
          method: "RAZORPAY",
          status: "FAILED",
          amountPaise: 20_000,
          razorpayPaymentId: "pay_c",
        },
      ],
    });
    await db.refund.create({
      data: {
        orderId: a.id,
        amountPaise: 5_000,
        reason: "Partial",
        method: "RAZORPAY",
        status: "PENDING",
      },
    });
    await db.paymentEvent.create({
      data: {
        eventId: "evt_stuck",
        eventType: "payment.captured",
        source: "webhook",
        signatureValid: true,
        payload: {},
        receivedAt: new Date(Date.now() - 10 * 60_000),
      },
    });

    const d = await getPaymentsDashboard({});
    expect(d.tiles.capturedToday).toEqual({ paise: 50_000, count: 1 });
    expect(d.tiles.captured7d).toEqual({ paise: 80_000, count: 2 });
    expect(d.tiles.failed7d).toBe(1);
    expect(d.tiles.refundsPending).toEqual({ paise: 5_000, count: 1 });
    expect(d.tiles.awaitingPayment).toBe(1);
    expect(d.tiles.stuckEvents).toBe(1);
    expect(d.eventQueue.map((e) => e.eventId)).toEqual(["evt_stuck"]);
    expect(d.refundQueue).toHaveLength(1);
    expect(
      (await getPaymentsDashboard({ status: "FAILED" })).payments.map((p) => p.razorpayPaymentId),
    ).toEqual(["pay_c"]);
    // Search by order number finds that order's payments only (COD checkout also records one).
    const found = (await getPaymentsDashboard({ q: a.orderNumber })).payments;
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((p) => p.order.orderNumber === a.orderNumber)).toBe(true);
  });
});

describe("shipments dashboard", () => {
  it("groups shipments by stage and lists the attention queue", async () => {
    const orders: Awaited<ReturnType<typeof order>>[] = [];
    for (let i = 0; i < 5; i++) orders.push(await order()); // fixtures are not parallel-safe
    const make = (i: number, status: string, extra: object = {}) =>
      db.shipment.create({
        data: {
          orderId: orders[i]!.id,
          carrier: "Test Courier",
          provider: "mock",
          reference: `${orders[i]!.orderNumber}-1`,
          status: status as never,
          ...extra,
        },
      });
    await make(0, "IN_TRANSIT");
    await make(1, "OUT_FOR_DELIVERY");
    await make(2, "DELIVERED");
    await make(3, "FAILED", { lastError: "Pincode not serviceable", needsAttention: true });
    await make(4, "RTO_INITIATED", { needsAttention: true });
    await db.webhookEvent.create({
      data: {
        provider: "shiprocket",
        dedupeKey: "k1",
        payload: { awb: "UNKNOWN1" },
        note: "Unknown AWB",
        processedAt: new Date(),
      },
    });

    const d = await getShipmentsDashboard({});
    const g = Object.fromEntries(d.groups.map((x) => [x.label, x.count]));
    expect(g).toMatchObject({
      "In transit": 1,
      "Out for delivery": 1,
      Delivered: 1,
      "Booking failed": 1,
      "RTO in progress": 1,
    });
    expect(d.tiles.inTransit).toBe(2); // in transit + out for delivery
    expect(d.tiles.delivered7d).toBe(1);
    expect(d.attention.map((s) => s.status).sort()).toEqual(["FAILED", "RTO_INITIATED"]);
    expect(d.unmatched).toEqual([
      expect.objectContaining({ awb: "UNKNOWN1", note: "Unknown AWB" }),
    ]);
    expect((await getShipmentsDashboard({ status: "DELIVERED" })).shipments).toHaveLength(1);
  });
});
