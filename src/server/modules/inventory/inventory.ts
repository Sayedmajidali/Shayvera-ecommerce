import type { InventoryReason } from "@prisma/client";
import { db, type Tx } from "@/server/platform/db";
import { AppError } from "@/lib/errors";

type Movement = {
  variantId: string;
  delta: number;
  reason: InventoryReason;
  orderId?: string | null;
  note?: string | null;
  actorId?: string | null;
};

/**
 * Applies a physical stock movement (receipts, adjustments, damage, returns) atomically and records
 * it in the ledger. Decrements use a conditional update on *available* stock, so neither concurrent
 * requests nor adjustments can drive stock negative or below units reserved for open orders.
 * Order placement does not use this: it reserves (see below).
 */
export async function moveStock(tx: Tx, m: Movement): Promise<number> {
  if (m.delta === 0) throw new AppError("VALIDATION_ERROR", "Stock movement cannot be zero");
  if (m.delta < 0) {
    // Never below what is reserved for open orders: on hand − |delta| ≥ reserved.
    const res = await tx.$executeRaw`
      UPDATE "Inventory" SET "quantityOnHand" = "quantityOnHand" + ${m.delta}, "updatedAt" = NOW()
      WHERE "variantId" = ${m.variantId} AND "quantityOnHand" - "quantityReserved" >= ${-m.delta}`;
    if (res === 0) {
      throw new AppError(
        "OUT_OF_STOCK",
        "Not enough unreserved stock — some units are held for open orders",
        { variantId: m.variantId },
      );
    }
  } else {
    await tx.inventory.upsert({
      where: { variantId: m.variantId },
      update: { quantityOnHand: { increment: m.delta } },
      create: { variantId: m.variantId, quantityOnHand: m.delta },
    });
  }
  const inv = await tx.inventory.findUniqueOrThrow({ where: { variantId: m.variantId } });
  await tx.inventoryTransaction.create({
    data: {
      variantId: m.variantId,
      delta: m.delta,
      balanceAfter: inv.quantityOnHand,
      reason: m.reason,
      orderId: m.orderId ?? null,
      note: m.note ?? null,
      actorId: m.actorId ?? null,
    },
  });
  return inv.quantityOnHand;
}

// ───────────────────────────── Reservations ─────────────────────────────
//
// available = quantityOnHand − quantityReserved
//   reserve  (order placed)          reserved += q                       reservation ACTIVE
//   consume  (handed to the courier) onHand −= q, reserved −= q, ledger   reservation CONSUMED
//   release  (cancelled / expired)   reserved −= q                       reservation RELEASED
// Every step is a conditional single-row UPDATE, so concurrent orders cannot oversell; the DB CHECK
// (0 ≤ reserved ≤ onHand) is the last line of defence.

/** Holds `quantity` units for an order line, or throws OUT_OF_STOCK (aborting the transaction). */
export async function reserveStock(
  tx: Tx,
  r: { orderId: string; variantId: string; quantity: number; expiresAt?: Date | null },
) {
  if (!Number.isInteger(r.quantity) || r.quantity <= 0)
    throw new AppError("VALIDATION_ERROR", "Reservation quantity must be positive");
  const res = await tx.$executeRaw`
    UPDATE "Inventory" SET "quantityReserved" = "quantityReserved" + ${r.quantity}, "updatedAt" = NOW()
    WHERE "variantId" = ${r.variantId} AND "quantityOnHand" - "quantityReserved" >= ${r.quantity}`;
  if (res === 0)
    throw new AppError("OUT_OF_STOCK", "Not enough stock available", { variantId: r.variantId });
  return tx.inventoryReservation.create({
    data: {
      orderId: r.orderId,
      variantId: r.variantId,
      quantity: r.quantity,
      expiresAt: r.expiresAt ?? null,
    },
  });
}

/**
 * Settles an order's ACTIVE reservations. Each reservation row is claimed with a conditional
 * status update first, so running this twice (or concurrently) never double-counts.
 */
async function settleReservations(
  tx: Tx,
  orderId: string,
  outcome: "CONSUMED" | "RELEASED",
  meta: { actorId?: string | null; note?: string | null },
) {
  const active = await tx.inventoryReservation.findMany({ where: { orderId, status: "ACTIVE" } });
  let units = 0;
  for (const r of active) {
    const claimed = await tx.inventoryReservation.updateMany({
      where: { id: r.id, status: "ACTIVE" },
      data: { status: outcome, resolvedAt: new Date() },
    });
    if (claimed.count === 0) continue;
    if (outcome === "RELEASED") {
      const res = await tx.$executeRaw`
        UPDATE "Inventory" SET "quantityReserved" = "quantityReserved" - ${r.quantity}, "updatedAt" = NOW()
        WHERE "variantId" = ${r.variantId} AND "quantityReserved" >= ${r.quantity}`;
      if (res === 0) throw new AppError("CONFLICT", "Inventory reservation is out of sync");
    } else {
      const res = await tx.$executeRaw`
        UPDATE "Inventory"
        SET "quantityOnHand" = "quantityOnHand" - ${r.quantity},
            "quantityReserved" = "quantityReserved" - ${r.quantity}, "updatedAt" = NOW()
        WHERE "variantId" = ${r.variantId} AND "quantityReserved" >= ${r.quantity}
          AND "quantityOnHand" >= ${r.quantity}`;
      if (res === 0) throw new AppError("CONFLICT", "Inventory reservation is out of sync");
      const inv = await tx.inventory.findUniqueOrThrow({ where: { variantId: r.variantId } });
      await tx.inventoryTransaction.create({
        data: {
          variantId: r.variantId,
          delta: -r.quantity,
          balanceAfter: inv.quantityOnHand,
          reason: "ORDER_FULFILLED",
          orderId,
          note: meta.note ?? null,
          actorId: meta.actorId ?? null,
        },
      });
    }
    units += r.quantity;
  }
  return { reservations: active.length, units };
}

/** Order handed to the courier: reserved units leave the warehouse. */
export function consumeReservations(
  tx: Tx,
  orderId: string,
  meta: { actorId?: string | null; note?: string | null } = {},
) {
  return settleReservations(tx, orderId, "CONSUMED", meta);
}

/** Order cancelled or payment window lapsed before shipping: reserved units become available again. */
export function releaseReservations(
  tx: Tx,
  orderId: string,
  meta: { actorId?: string | null; note?: string | null } = {},
) {
  return settleReservations(tx, orderId, "RELEASED", meta);
}

/** Payment confirmed: the hold no longer expires. */
export async function clearReservationExpiry(tx: Tx, orderId: string) {
  await tx.inventoryReservation.updateMany({
    where: { orderId, status: "ACTIVE", expiresAt: { not: null } },
    data: { expiresAt: null },
  });
}

export type InventoryDrift = {
  variantId: string;
  sku: string;
  reserved: number;
  activeReservations: number;
};

/**
 * Compares each variant's quantityReserved with the sum of its ACTIVE reservations. Reports only:
 * stock is never changed automatically — staff investigate and correct.
 */
export async function findInventoryDrift(): Promise<InventoryDrift[]> {
  const rows = await db.$queryRaw<InventoryDrift[]>`
    SELECT i."variantId", v.sku, i."quantityReserved" AS reserved,
           COALESCE(SUM(r.quantity) FILTER (WHERE r.status = 'ACTIVE'), 0)::int AS "activeReservations"
    FROM "Inventory" i
    JOIN "ProductVariant" v ON v.id = i."variantId"
    LEFT JOIN "InventoryReservation" r ON r."variantId" = i."variantId"
    GROUP BY i."variantId", v.sku, i."quantityReserved"
    HAVING i."quantityReserved" <> COALESCE(SUM(r.quantity) FILTER (WHERE r.status = 'ACTIVE'), 0)
    ORDER BY v.sku`;
  return rows;
}

export async function adjustStock(input: Movement) {
  return db.$transaction((tx) => moveStock(tx, input));
}

export async function setLowStockThreshold(variantId: string, threshold: number) {
  return db.inventory.upsert({
    where: { variantId },
    update: { lowStockThreshold: threshold },
    create: { variantId, quantityOnHand: 0, lowStockThreshold: threshold },
  });
}

export async function listLowStock(limit = 20) {
  return db.$queryRaw<
    {
      variantId: string;
      sku: string;
      variantName: string;
      productId: string;
      productName: string;
      quantityOnHand: number;
      quantityReserved: number;
      available: number;
      lowStockThreshold: number;
    }[]
  >`
    SELECT i."variantId", v.sku, v.name AS "variantName", p.id AS "productId", p.name AS "productName",
           i."quantityOnHand", i."quantityReserved",
           (i."quantityOnHand" - i."quantityReserved") AS available, i."lowStockThreshold"
    FROM "Inventory" i
    JOIN "ProductVariant" v ON v.id = i."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE v."isActive" AND p.status <> 'ARCHIVED'
      AND i."quantityOnHand" - i."quantityReserved" <= i."lowStockThreshold"
    ORDER BY available ASC, p.name ASC
    LIMIT ${limit}`;
}
