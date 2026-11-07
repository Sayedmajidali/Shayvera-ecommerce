/**
 * Concurrency suite (specification §18). Each test fires real parallel requests/transactions at the
 * database and then checks invariants rather than a particular interleaving.
 * Related concurrency tests elsewhere:
 * - last unit with many buyers, double-submitted checkout, coupon global limit — checkout.test.ts
 * - concurrent shipment booking — shipping.test.ts
 * - duplicate/concurrent Razorpay webhooks and callbacks — payments(-hardening).test.ts
 * - concurrent refunds (order and return) — payments.test.ts, returns-notifications.test.ts
 * - duplicate stock adjustments (same key) — security-sweeps.test.ts
 */
import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import * as stockRoute from "@/app/api/admin/variants/[id]/stock/route";
import * as courierWebhook from "@/app/api/webhooks/courier/route";
import { findInventoryDrift } from "@/server/modules/inventory/inventory";
import { transitionOrder } from "@/server/modules/orders/orders";
import { apiRequest, createAdmin, params } from "../helpers/auth";
import { cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { makeProduct } from "../helpers/fixtures";

type Handler = (req: Request, ctx: unknown) => Promise<Response>;

const adjust = (cookie: string, variantId: string, delta: number, reason = "RESTOCK") =>
  (stockRoute.POST as Handler)(
    apiRequest(`/api/admin/variants/${variantId}/stock`, {
      method: "POST",
      cookie,
      body: { delta, reason, idempotencyKey: crypto.randomUUID() },
    }),
    params({ id: variantId }),
  );

async function invariants(variantId: string, onHandBefore: number) {
  const inv = await db.inventory.findUniqueOrThrow({ where: { variantId } });
  const ledger = await db.inventoryTransaction.aggregate({
    where: { variantId },
    _sum: { delta: true },
  });
  const active = await db.inventoryReservation.aggregate({
    where: { variantId, status: "ACTIVE" },
    _sum: { quantity: true },
  });
  expect(inv.quantityReserved).toBeGreaterThanOrEqual(0);
  expect(inv.quantityOnHand).toBeGreaterThanOrEqual(inv.quantityReserved);
  // Every change to on-hand stock is in the ledger, exactly once.
  expect(inv.quantityOnHand).toBe(onHandBefore + (ledger._sum.delta ?? 0));
  // Reserved units equal the open reservations.
  expect(inv.quantityReserved).toBe(active._sum.quantity ?? 0);
  expect(await findInventoryDrift()).toEqual([]);
  return inv;
}

describe("concurrent inventory updates", () => {
  it("checkouts racing staff adjustments never oversell and keep stock, ledger and holds consistent", async () => {
    const { cookie } = await createAdmin();
    const p = await makeProduct({ stock: 10, price: 30_000 });
    const variantId = p.variants[0]!.id;
    const carts = await Promise.all(Array.from({ length: 8 }, () => cartWith(variantId, 2)));

    const results = await Promise.allSettled([
      ...carts.map((c) => checkout(c, checkoutBody())),
      adjust(cookie, variantId, -3, "DAMAGE"),
      adjust(cookie, variantId, 4, "RESTOCK"),
      adjust(cookie, variantId, -2, "CORRECTION"),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const inv = await invariants(variantId, 10);
    const orders = await db.order.findMany({
      where: { items: { some: { variantId } } },
      include: { items: true },
    });
    const sold = orders.reduce((t, o) => t + o.items.reduce((u, i) => u + i.quantity, 0), 0);
    // Every order is covered by a hold; nothing was sold that did not exist.
    expect(inv.quantityReserved).toBe(sold);
    expect(sold).toBeLessThanOrEqual(inv.quantityOnHand);
    expect(orders.length).toBeGreaterThan(0);
  });

  it("parallel adjustments are not lost (no read-modify-write)", async () => {
    const { cookie } = await createAdmin();
    const p = await makeProduct({ stock: 0 });
    const variantId = p.variants[0]!.id;
    const res = await Promise.all(Array.from({ length: 20 }, () => adjust(cookie, variantId, 1)));
    expect(res.map((r) => r.status)).toEqual(Array(20).fill(200));
    const inv = await invariants(variantId, 0);
    expect(inv.quantityOnHand).toBe(20);
    expect(await db.inventoryTransaction.count({ where: { variantId } })).toBe(20);
  });

  it("removals racing each other cannot take stock below what is reserved", async () => {
    const { cookie } = await createAdmin();
    const p = await makeProduct({ stock: 6, price: 30_000 });
    const variantId = p.variants[0]!.id;
    await checkout(await cartWith(variantId, 2), checkoutBody()); // 2 reserved, 4 removable
    const res = await Promise.all(
      Array.from({ length: 6 }, () => adjust(cookie, variantId, -1, "DAMAGE")),
    );
    const ok = res.filter((r) => r.status === 200).length;
    expect(ok).toBe(4);
    expect(res.filter((r) => r.status === 409)).toHaveLength(2);
    const inv = await invariants(variantId, 6);
    expect(inv).toMatchObject({ quantityOnHand: 2, quantityReserved: 2 });
  });
});

describe("conflicting order updates", () => {
  it("cancel and pack at the same moment: exactly one wins and stock follows the winner", async () => {
    const p = await makeProduct({ stock: 5, price: 30_000 });
    const variantId = p.variants[0]!.id;
    const { json } = await checkout(await cartWith(variantId, 2), checkoutBody());
    const orderId = json.data.orderId as string;
    const run = (to: "CANCELLED" | "READY_TO_SHIP") =>
      db.$transaction((tx) => transitionOrder(tx, { orderId, to, actor: { type: "SYSTEM" } }));
    const [a, b] = await Promise.allSettled([run("CANCELLED"), run("READY_TO_SHIP")]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    const inv = await invariants(variantId, 5);
    if (order.status === "CANCELLED") {
      expect(inv).toMatchObject({ quantityOnHand: 5, quantityReserved: 0 });
    } else {
      expect(order.status).toBe("READY_TO_SHIP");
      expect(inv).toMatchObject({ quantityOnHand: 3, quantityReserved: 0 });
    }
    expect(await db.orderStatusHistory.count({ where: { orderId, toStatus: order.status } })).toBe(
      1,
    );
  });
});

describe("duplicate webhook events delivered at the same time", () => {
  it("courier: five simultaneous deliveries of one scan store one event and queue one job", async () => {
    process.env.SHIPROCKET_WEBHOOK_TOKEN = "courier-token";
    try {
      const body = JSON.stringify({
        awb: "AWBCONC1",
        current_status: "IN TRANSIT",
        shipment_status_id: 18,
        current_timestamp: "07 11 2026 10:15:00",
        scans: [],
      });
      const send = () =>
        (courierWebhook.POST as Handler)(
          new Request("http://localhost:3000/api/webhooks/courier", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": "courier-token" },
            body,
          }),
          undefined,
        );
      const res = await Promise.all(Array.from({ length: 5 }, send));
      expect(res.map((r) => r.status)).toEqual(Array(5).fill(200));
      const duplicates = (await Promise.all(res.map((r) => r.json()))).filter((j) => j.duplicate);
      expect(duplicates).toHaveLength(4);
      expect(await db.webhookEvent.count()).toBe(1);
      expect(await db.job.count({ where: { type: "shipping.webhook" } })).toBe(1);
    } finally {
      delete process.env.SHIPROCKET_WEBHOOK_TOKEN;
    }
  });
});
