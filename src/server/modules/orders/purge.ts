import { db } from "@/server/platform/db";
import { audit } from "@/server/modules/audit/audit";

/*
 * Permanently removes orders — meant for test orders placed before launch. Everything that belongs to
 * an order goes with it (items, payments, refunds, shipments, invoices/credit notes, requests,
 * history, reservations, coupon usages), and the store's counters are put right first:
 * - stock held by ACTIVE reservations is released (Inventory.quantityReserved);
 * - stock taken by shipped orders (CONSUMED reservations) is put back, unless the order was returned
 *   (returns already restock) or `restock` is false; each put-back is recorded in the stock ledger;
 * - product sales counts and coupon usage counts are reduced.
 * Payment-gateway / courier records outside this store are NOT touched (Razorpay, Shiprocket).
 */

export type PurgeOptions = {
  orderNumbers?: string[];
  all?: boolean;
  dryRun: boolean;
  restock?: boolean;
  /** Restart order/invoice/credit-note numbering — only allowed when no orders remain afterwards. */
  resetNumbering?: boolean;
  actorId?: string | null;
};

export type PurgeReport = {
  dryRun: boolean;
  orders: {
    orderNumber: string;
    status: string;
    paymentStatus: string;
    totalPaise: number;
    email: string;
    placedAt: Date;
    invoice: string | null;
  }[];
  missing: string[];
  releasedUnits: number;
  restockedUnits: number;
  numberingReset: boolean;
};

export async function listOrdersForPurge() {
  return db.order.findMany({
    orderBy: { placedAt: "asc" },
    select: {
      orderNumber: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      totalPaise: true,
      email: true,
      placedAt: true,
    },
  });
}

export async function purgeOrders(opts: PurgeOptions): Promise<PurgeReport> {
  if (!opts.all && !opts.orderNumbers?.length) throw new Error("Choose orders (--orders) or --all");
  const restock = opts.restock ?? true;
  const orders = await db.order.findMany({
    where: opts.all ? {} : { orderNumber: { in: opts.orderNumbers } },
    include: {
      items: { select: { productId: true, quantity: true } },
      reservations: true,
      statusHistory: { select: { toStatus: true } },
      invoice: { select: { invoiceNumber: true } },
      payments: { select: { id: true } },
      shipments: { select: { id: true } },
    },
    orderBy: { placedAt: "asc" },
  });
  const found = new Set(orders.map((o) => o.orderNumber));
  const report: PurgeReport = {
    dryRun: opts.dryRun,
    orders: orders.map((o) => ({
      orderNumber: o.orderNumber,
      status: o.status,
      paymentStatus: o.paymentStatus,
      totalPaise: o.totalPaise,
      email: o.email,
      placedAt: o.placedAt,
      invoice: o.invoice?.invoiceNumber ?? null,
    })),
    missing: opts.all ? [] : (opts.orderNumbers ?? []).filter((n) => !found.has(n)),
    releasedUnits: 0,
    restockedUnits: 0,
    numberingReset: false,
  };

  for (const o of orders) {
    const returned = o.statusHistory.some((h) => h.toStatus === "RETURNED");
    for (const r of o.reservations) {
      if (r.status === "ACTIVE") report.releasedUnits += r.quantity;
      if (r.status === "CONSUMED" && restock && !returned) report.restockedUnits += r.quantity;
    }
  }
  if (opts.resetNumbering) {
    const remaining = await db.order.count({ where: { orderNumber: { notIn: [...found] } } });
    if (remaining > 0)
      throw new Error(
        `Numbering can only be reset when no orders remain (${remaining} would remain)`,
      );
  }
  if (opts.dryRun || orders.length === 0) return report;

  const ids = orders.map((o) => o.id);
  await db.$transaction(
    async (tx) => {
      for (const o of orders) {
        const returned = o.statusHistory.some((h) => h.toStatus === "RETURNED");
        for (const r of o.reservations) {
          if (r.status === "ACTIVE") {
            await tx.$executeRaw`
              UPDATE "Inventory" SET "quantityReserved" = GREATEST(0, "quantityReserved" - ${r.quantity}),
                "updatedAt" = NOW() WHERE "variantId" = ${r.variantId}`;
          } else if (r.status === "CONSUMED" && restock && !returned) {
            const inv = await tx.inventory.upsert({
              where: { variantId: r.variantId },
              update: { quantityOnHand: { increment: r.quantity } },
              create: { variantId: r.variantId, quantityOnHand: r.quantity },
            });
            await tx.inventoryTransaction.create({
              data: {
                variantId: r.variantId,
                delta: r.quantity,
                balanceAfter: inv.quantityOnHand,
                reason: "ADJUSTMENT",
                note: `Test order ${o.orderNumber} removed — stock put back`,
                actorId: opts.actorId ?? null,
              },
            });
          }
        }
        if (o.confirmedAt) {
          for (const item of o.items) {
            if (!item.productId) continue;
            await tx.$executeRaw`
              UPDATE "Product" SET "salesCount" = GREATEST(0, "salesCount" - ${item.quantity})
              WHERE id = ${item.productId}`;
          }
        }
      }
      const usages = await tx.couponUsage.findMany({
        where: { orderId: { in: ids } },
        select: { couponId: true },
      });
      for (const u of usages) {
        await tx.$executeRaw`
          UPDATE "Coupon" SET "usedCount" = GREATEST(0, "usedCount" - 1) WHERE id = ${u.couponId}`;
      }
      // Records that only point at these orders (they would otherwise be left orphaned).
      const paymentIds = orders.flatMap((o) => o.payments.map((p) => p.id));
      await tx.paymentEvent.deleteMany({
        where: { OR: [{ orderId: { in: ids } }, { paymentId: { in: paymentIds } }] },
      });
      await tx.notification.deleteMany({ where: { orderId: { in: ids } } });
      await tx.$executeRaw`
        DELETE FROM "Job" WHERE status <> 'RUNNING' AND (
          payload->>'orderId' = ANY(${ids}) OR payload->>'shipmentId' = ANY(${orders.flatMap((o) => o.shipments.map((s) => s.id))}))`;
      await tx.order.deleteMany({ where: { id: { in: ids } } });

      if (opts.resetNumbering) {
        await tx.$executeRaw`
          DELETE FROM "Sequence" WHERE key = 'order' OR key LIKE 'invoice:%' OR key LIKE 'credit-note:%'`;
        report.numberingReset = true;
      }
      await audit(
        {
          actorId: opts.actorId ?? null,
          action: "order.purge",
          entityType: "Order",
          entityId: null,
          metadata: {
            orders: orders.map((o) => o.orderNumber),
            releasedUnits: report.releasedUnits,
            restockedUnits: report.restockedUnits,
            numberingReset: report.numberingReset,
          },
        },
        tx,
      );
    },
    { timeout: 120_000 },
  );
  return report;
}
