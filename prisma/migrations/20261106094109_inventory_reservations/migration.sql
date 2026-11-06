-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');

-- AlterEnum
ALTER TYPE "InventoryReason" ADD VALUE 'ORDER_FULFILLED';

-- AlterTable
ALTER TABLE "Inventory" ADD COLUMN     "quantityReserved" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "InventoryReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryReservation_orderId_idx" ON "InventoryReservation"("orderId");

-- CreateIndex
CREATE INDEX "InventoryReservation_variantId_status_idx" ON "InventoryReservation"("variantId", "status");

-- CreateIndex
CREATE INDEX "InventoryReservation_status_expiresAt_idx" ON "InventoryReservation"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───────── Convert open orders to the reservation model (available stock is unchanged) ─────────
-- Before this migration, placing an order removed units from quantityOnHand. For orders that have not
-- shipped yet, put those units back on hand and hold them as ACTIVE reservations instead.
CREATE TEMP TABLE "_open_lines" ON COMMIT DROP AS
SELECT oi."orderId", oi."variantId", SUM(oi.quantity)::int AS qty,
       CASE WHEN o.status = 'PENDING' THEN o."paymentExpiresAt" END AS "expiresAt"
FROM "OrderItem" oi
JOIN "Order" o ON o.id = oi."orderId"
JOIN "ProductVariant" v ON v.id = oi."variantId"
WHERE o.status IN ('PENDING', 'CONFIRMED', 'PROCESSING')
GROUP BY oi."orderId", oi."variantId", o.status, o."paymentExpiresAt";

INSERT INTO "InventoryReservation" ("id", "orderId", "variantId", "quantity", "status", "expiresAt", "createdAt")
SELECT gen_random_uuid()::text, "orderId", "variantId", qty, 'ACTIVE', "expiresAt", CURRENT_TIMESTAMP
FROM "_open_lines";

CREATE TEMP TABLE "_held" ON COMMIT DROP AS
SELECT "variantId", SUM(qty)::int AS qty FROM "_open_lines" GROUP BY "variantId";

UPDATE "Inventory" i
SET "quantityOnHand" = i."quantityOnHand" + h.qty,
    "quantityReserved" = i."quantityReserved" + h.qty,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_held" h
WHERE i."variantId" = h."variantId";

INSERT INTO "InventoryTransaction" ("id", "variantId", "delta", "balanceAfter", "reason", "note", "createdAt")
SELECT gen_random_uuid()::text, h."variantId", h.qty, i."quantityOnHand", 'CORRECTION',
       'Open orders converted to reservations (units were held off-hand; now held as reserved)', CURRENT_TIMESTAMP
FROM "_held" h JOIN "Inventory" i ON i."variantId" = h."variantId";

-- Invariants: never negative, never more reserved than physically on hand.
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_quantities_valid"
  CHECK ("quantityOnHand" >= 0 AND "quantityReserved" >= 0 AND "quantityReserved" <= "quantityOnHand");
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_quantity_positive" CHECK ("quantity" > 0);
