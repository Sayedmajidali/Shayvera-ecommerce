-- CreateEnum
CREATE TYPE "OrderRequestType" AS ENUM ('CANCELLATION', 'RETURN');

-- CreateEnum
CREATE TYPE "OrderRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'WITHDRAWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'PAYMENT_FAILED';
ALTER TYPE "OrderStatus" ADD VALUE 'READY_TO_SHIP';
ALTER TYPE "OrderStatus" ADD VALUE 'OUT_FOR_DELIVERY';
ALTER TYPE "OrderStatus" ADD VALUE 'CANCELLATION_REQUESTED';
ALTER TYPE "OrderStatus" ADD VALUE 'RETURN_REQUESTED';
ALTER TYPE "OrderStatus" ADD VALUE 'RETURNED';
ALTER TYPE "OrderStatus" ADD VALUE 'REFUND_PENDING';

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "returnWindowDays" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "OrderRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OrderRequestType" NOT NULL,
    "status" "OrderRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(500) NOT NULL,
    "lines" JSONB,
    "previousStatus" "OrderStatus" NOT NULL,
    "requestedById" TEXT,
    "resolutionNote" VARCHAR(500),
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "receipt" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderRequest_orderId_idx" ON "OrderRequest"("orderId");

-- CreateIndex
CREATE INDEX "OrderRequest_status_createdAt_idx" ON "OrderRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderRequest" ADD CONSTRAINT "OrderRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one open (pending or approved) request per order, enforced by the database.
CREATE UNIQUE INDEX "OrderRequest_one_open_per_order" ON "OrderRequest"("orderId")
  WHERE "status" IN ('PENDING', 'APPROVED');
ALTER TABLE "StoreSettings" ADD CONSTRAINT "StoreSettings_return_window_valid"
  CHECK ("returnWindowDays" >= 0 AND "returnWindowDays" <= 60);
