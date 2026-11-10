import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import { purgeOrders } from "@/server/modules/orders/purge";
import { updateOrderStatusAdmin } from "@/server/modules/orders/admin-orders";
import { availableStock, drainJobs } from "../helpers/db";
import { createAdmin } from "../helpers/auth";
import { cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { makeProduct } from "../helpers/fixtures";

async function codOrder(variantId: string, qty = 1) {
  const cookie = await cartWith(variantId, qty);
  const { json } = await checkout(cookie, checkoutBody());
  return db.order.findUniqueOrThrow({ where: { orderNumber: json.data.orderNumber } });
}

const onHand = async (variantId: string) =>
  (await db.inventory.findUniqueOrThrow({ where: { variantId } })).quantityOnHand;

describe("removing test orders", () => {
  it("preview changes nothing; apply removes the order and everything that belongs to it", async () => {
    const p = await makeProduct({ stock: 10, price: 50_000 });
    const v = p.variants[0]!.id;
    const o = await codOrder(v, 2);
    expect(await availableStock(v)).toBe(8);

    const preview = await purgeOrders({
      orderNumbers: [o.orderNumber, "SHV99999999"],
      dryRun: true,
    });
    expect(preview.orders.map((x) => x.orderNumber)).toEqual([o.orderNumber]);
    expect(preview.missing).toEqual(["SHV99999999"]);
    expect(preview.releasedUnits).toBe(2);
    expect(await db.order.count()).toBe(1);

    await purgeOrders({ orderNumbers: [o.orderNumber], dryRun: false });
    expect(await db.order.count()).toBe(0);
    expect(await db.orderItem.count()).toBe(0);
    expect(await db.payment.count()).toBe(0);
    expect(await db.inventoryReservation.count()).toBe(0);
    expect(await availableStock(v)).toBe(10); // held stock released
    expect(await onHand(v)).toBe(10);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).salesCount).toBe(0);
    expect(await db.adminAuditLog.count({ where: { action: "order.purge" } })).toBe(1);
  });

  it("puts back stock taken by a shipped test order (unless --no-restock)", async () => {
    const { user } = await createAdmin();
    const p = await makeProduct({ stock: 10, price: 50_000 });
    const v = p.variants[0]!.id;
    const a = await codOrder(v, 3);
    const b = await codOrder(v, 1);
    for (const o of [a, b])
      await updateOrderStatusAdmin(o.id, { status: "READY_TO_SHIP", note: null }, { id: user.id });
    await drainJobs();
    expect(await onHand(v)).toBe(6); // packed → stock consumed

    const r = await purgeOrders({ orderNumbers: [a.orderNumber], dryRun: false });
    expect(r.restockedUnits).toBe(3);
    expect(await onHand(v)).toBe(9);
    expect(
      await db.inventoryTransaction.count({
        where: { variantId: v, reason: "ADJUSTMENT", note: { contains: a.orderNumber } },
      }),
    ).toBe(1);

    await purgeOrders({ orderNumbers: [b.orderNumber], dryRun: false, restock: false });
    expect(await onHand(v)).toBe(9);
    expect(await availableStock(v)).toBe(9);
  });

  it("reduces coupon usage and refuses to reset numbering while other orders remain", async () => {
    const p = await makeProduct({ stock: 10, price: 100_000 });
    const coupon = await db.coupon.create({
      data: { code: "TESTPURGE", type: "FIXED", value: 1_000, usedCount: 1 },
    });
    const keep = await codOrder(p.variants[0]!.id);
    const gone = await codOrder(p.variants[0]!.id);
    await db.couponUsage.create({
      data: {
        couponId: coupon.id,
        orderId: gone.id,
        email: "buyer@example.com",
        discountPaise: 1_000,
      },
    });

    await expect(
      purgeOrders({ orderNumbers: [gone.orderNumber], dryRun: false, resetNumbering: true }),
    ).rejects.toThrow(/no orders remain/);
    expect(await db.order.count()).toBe(2); // nothing deleted

    await purgeOrders({ orderNumbers: [gone.orderNumber], dryRun: false });
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(0);
    expect(await db.order.findUnique({ where: { id: keep.id } })).not.toBeNull();
  });

  it("--all with numbering reset makes the next order number start again at 000001", async () => {
    const p = await makeProduct({ stock: 10, price: 50_000 });
    await codOrder(p.variants[0]!.id);
    await codOrder(p.variants[0]!.id);
    const r = await purgeOrders({ all: true, dryRun: false, resetNumbering: true });
    expect(r.orders).toHaveLength(2);
    expect(r.numberingReset).toBe(true);
    const next = await codOrder(p.variants[0]!.id);
    expect(next.orderNumber).toMatch(/000001$/);
  });
});
