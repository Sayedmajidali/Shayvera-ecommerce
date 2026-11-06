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
 * Applies a stock movement atomically and records it in the ledger.
 * Decrements use a conditional update so concurrent requests can never drive stock negative:
 * if fewer than |delta| units remain, nothing is updated and OUT_OF_STOCK is thrown.
 */
export async function moveStock(tx: Tx, m: Movement): Promise<number> {
  if (m.delta === 0) throw new AppError("VALIDATION_ERROR", "Stock movement cannot be zero");
  if (m.delta < 0) {
    const res = await tx.inventory.updateMany({
      where: { variantId: m.variantId, quantityOnHand: { gte: -m.delta } },
      data: { quantityOnHand: { increment: m.delta } },
    });
    if (res.count === 0) {
      throw new AppError("OUT_OF_STOCK", "Not enough stock available", { variantId: m.variantId });
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
      lowStockThreshold: number;
    }[]
  >`
    SELECT i."variantId", v.sku, v.name AS "variantName", p.id AS "productId", p.name AS "productName",
           i."quantityOnHand", i."lowStockThreshold"
    FROM "Inventory" i
    JOIN "ProductVariant" v ON v.id = i."variantId"
    JOIN "Product" p ON p.id = v."productId"
    WHERE v."isActive" AND p.status <> 'ARCHIVED' AND i."quantityOnHand" <= i."lowStockThreshold"
    ORDER BY i."quantityOnHand" ASC, p.name ASC
    LIMIT ${limit}`;
}
