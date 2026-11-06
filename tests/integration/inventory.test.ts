import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import * as itemsRoute from "@/app/api/cart/items/route";
import * as stockRoute from "@/app/api/admin/variants/[id]/stock/route";
import * as mockRoute from "@/app/api/payments/mock/complete/route";
import * as verifyRoute from "@/app/api/payments/razorpay/verify/route";
import { transitionOrder } from "@/server/modules/orders/orders";
import {
  consumeReservations,
  findInventoryDrift,
  releaseReservations,
} from "@/server/modules/inventory/inventory";
import { listProducts, productListParamsSchema } from "@/server/modules/catalog/queries";
import { registerAllJobs } from "@/server/jobs";
import { enqueue } from "@/server/platform/jobs/queue";
import { runDueJobs } from "@/server/platform/jobs/runner";
import { resetPaymentGateway } from "@/server/modules/payments/gateway";
import { apiRequest, createAdmin, params } from "../helpers/auth";
import { cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { makeProduct } from "../helpers/fixtures";

const inv = (variantId: string) => db.inventory.findUniqueOrThrow({ where: { variantId } });
const move = (orderId: string, to: "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED") =>
  db.$transaction((tx) => transitionOrder(tx, { orderId, to, actor: { type: "SYSTEM" } }));

async function codOrder(stock = 10, qty = 2) {
  const p = await makeProduct({ stock });
  const variantId = p.variants[0]!.id;
  const cookie = await cartWith(variantId, qty);
  const { res, json } = await checkout(cookie, checkoutBody());
  expect(res.status).toBe(201);
  return { variantId, productId: p.id, orderId: json.data.orderId as string };
}

describe("inventory reservations", () => {
  it("reserve at placement → deduct when shipped → nothing more on delivery", async () => {
    const { variantId, orderId } = await codOrder(10, 2);
    expect(await inv(variantId)).toMatchObject({ quantityOnHand: 10, quantityReserved: 2 });

    await move(orderId, "PROCESSING");
    expect(await inv(variantId)).toMatchObject({ quantityOnHand: 10, quantityReserved: 2 });

    await move(orderId, "SHIPPED");
    expect(await inv(variantId)).toMatchObject({ quantityOnHand: 8, quantityReserved: 0 });
    expect(await db.inventoryReservation.findFirstOrThrow({ where: { orderId } })).toMatchObject({
      status: "CONSUMED",
    });
    const ledger = await db.inventoryTransaction.findMany({ where: { orderId } });
    expect(ledger.map((l) => [l.reason, l.delta, l.balanceAfter])).toEqual([
      ["ORDER_FULFILLED", -2, 8],
    ]);

    await move(orderId, "DELIVERED");
    expect(await inv(variantId)).toMatchObject({ quantityOnHand: 8, quantityReserved: 0 });
    expect(await findInventoryDrift()).toEqual([]);
  });

  it("cancellation releases the hold without touching on-hand stock or the ledger", async () => {
    const { variantId, orderId } = await codOrder(10, 3);
    await move(orderId, "CANCELLED");
    expect(await inv(variantId)).toMatchObject({ quantityOnHand: 10, quantityReserved: 0 });
    expect(await db.inventoryReservation.findFirstOrThrow({ where: { orderId } })).toMatchObject({
      status: "RELEASED",
    });
    expect(await db.inventoryTransaction.count({ where: { orderId } })).toBe(0);
  });

  it("settling is idempotent and a released hold can never be consumed", async () => {
    const { variantId, orderId } = await codOrder(10, 2);
    const first = await db.$transaction((tx) => releaseReservations(tx, orderId));
    const second = await db.$transaction((tx) => releaseReservations(tx, orderId));
    const consume = await db.$transaction((tx) => consumeReservations(tx, orderId));
    expect([first.units, second.units, consume.units]).toEqual([2, 0, 0]);
    expect(await inv(variantId)).toMatchObject({ quantityOnHand: 10, quantityReserved: 0 });
  });

  it("online holds expire with the payment window and stop expiring once paid", async () => {
    resetPaymentGateway();
    const p = await makeProduct({ stock: 5 });
    const cookie = await cartWith(p.variants[0]!.id, 1);
    const { json } = await checkout(cookie, checkoutBody({ paymentMethod: "RAZORPAY" }));
    const order = await db.order.findUniqueOrThrow({ where: { id: json.data.orderId } });
    const hold = await db.inventoryReservation.findFirstOrThrow({ where: { orderId: order.id } });
    expect(hold.expiresAt?.getTime()).toBe(order.paymentExpiresAt?.getTime());

    const sim = await mockRoute.POST(
      apiRequest("/api/payments/mock/complete", {
        method: "POST",
        body: { razorpayOrderId: json.data.payment.razorpayOrderId, outcome: "captured" },
      }),
      undefined,
    );
    const cb = (await sim.json()).data;
    const verified = await verifyRoute.POST(
      apiRequest("/api/payments/razorpay/verify", { method: "POST", body: cb }),
      undefined,
    );
    expect(verified.status).toBe(200);
    expect(
      (await db.inventoryReservation.findFirstOrThrow({ where: { orderId: order.id } })).expiresAt,
    ).toBeNull();
  });

  it("concurrent cancel and ship on one order: exactly one wins and stock stays consistent", async () => {
    const { variantId, orderId } = await codOrder(10, 4);
    const results = await Promise.allSettled([
      move(orderId, "CANCELLED"),
      move(orderId, "SHIPPED"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const status = (await db.order.findUniqueOrThrow({ where: { id: orderId } })).status;
    const stock = await inv(variantId);
    if (status === "SHIPPED")
      expect(stock).toMatchObject({ quantityOnHand: 6, quantityReserved: 0 });
    else expect(stock).toMatchObject({ quantityOnHand: 10, quantityReserved: 0 });
    expect(await findInventoryDrift()).toEqual([]);
  });

  it("orders placed before reservations existed are restocked on cancellation", async () => {
    const { variantId, orderId } = await codOrder(10, 2);
    // Simulate a legacy order: units taken off-hand at placement, no reservation rows.
    await db.inventoryReservation.deleteMany({ where: { orderId } });
    await db.inventory.update({
      where: { variantId },
      data: { quantityOnHand: 8, quantityReserved: 0 },
    });
    await move(orderId, "CANCELLED");
    expect(await inv(variantId)).toMatchObject({ quantityOnHand: 10, quantityReserved: 0 });
    expect(
      await db.inventoryTransaction.count({
        where: { orderId, reason: "ORDER_CANCELLED", delta: 2 },
      }),
    ).toBe(1);
  });
});

describe("available stock", () => {
  it("admins cannot remove units that are reserved for open orders", async () => {
    const { cookie } = await createAdmin();
    const { variantId } = await codOrder(5, 3);
    const adjust = (delta: number) =>
      stockRoute.POST(
        apiRequest(`/api/admin/variants/${variantId}/stock`, {
          method: "POST",
          cookie,
          body: { delta, reason: "DAMAGE" },
        }),
        params({ id: variantId }),
      );
    const tooMuch = await adjust(-3);
    expect(tooMuch.status).toBe(409);
    expect((await tooMuch.json()).error.message).toMatch(/held for open orders/);
    const ok = await adjust(-2);
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toEqual({
      quantityOnHand: 3,
      quantityReserved: 3,
      available: 0,
    });
  });

  it("fully reserved products are sold out on the storefront and cannot be added to a cart", async () => {
    const { variantId, productId } = await codOrder(2, 2);
    expect(await inv(variantId)).toMatchObject({ quantityOnHand: 2, quantityReserved: 2 });
    const list = await listProducts(productListParamsSchema.parse({}));
    expect(list.items.find((p) => p.id === productId)?.inStock).toBe(false);
    const inStockOnly = await listProducts(productListParamsSchema.parse({ inStock: "1" }));
    expect(inStockOnly.items.some((p) => p.id === productId)).toBe(false);

    const res = await itemsRoute.POST(
      apiRequest("/api/cart/items", { method: "POST", body: { variantId, quantity: 1 } }),
      undefined,
    );
    expect(res.status).toBe(409);
  });

  it("the database rejects reserving more than is on hand", async () => {
    const p = await makeProduct({ stock: 1 });
    await expect(
      db.inventory.update({
        where: { variantId: p.variants[0]!.id },
        data: { quantityReserved: 2 },
      }),
    ).rejects.toThrow();
  });
});

describe("inventory reconciliation", () => {
  it("reports drift and stale holds without changing stock", async () => {
    const { variantId } = await codOrder(10, 2);
    await db.inventory.update({ where: { variantId }, data: { quantityReserved: 5 } });
    expect(await findInventoryDrift()).toMatchObject([
      { variantId, reserved: 5, activeReservations: 2 },
    ]);

    registerAllJobs();
    await enqueue("inventory.reconcile", {});
    await runDueJobs();
    const state = await db.systemState.findUniqueOrThrow({
      where: { key: "inventory:reconciliation" },
    });
    expect(state.value).toMatchObject({ driftCount: 1, staleHolds: 0 });
    expect(await inv(variantId)).toMatchObject({ quantityOnHand: 10, quantityReserved: 5 });
  });
});
