-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShipmentStatus" ADD VALUE 'CREATING';
ALTER TYPE "ShipmentStatus" ADD VALUE 'CREATED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'AWB_ASSIGNED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'PICKUP_SCHEDULED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'PICKED_UP';
ALTER TYPE "ShipmentStatus" ADD VALUE 'UNDELIVERED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'RTO_INITIATED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'RTO_DELIVERED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'LOST';
ALTER TYPE "ShipmentStatus" ADD VALUE 'DAMAGED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "breadthMm" INTEGER,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "codAmountPaise" INTEGER,
ADD COLUMN     "courierId" VARCHAR(30),
ADD COLUMN     "etd" TIMESTAMP(3),
ADD COLUMN     "heightMm" INTEGER,
ADD COLUMN     "isReturn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "labelUrl" TEXT,
ADD COLUMN     "lastError" VARCHAR(500),
ADD COLUMN     "lastEventAt" TIMESTAMP(3),
ADD COLUMN     "lengthMm" INTEGER,
ADD COLUMN     "manifestUrl" TEXT,
ADD COLUMN     "needsAttention" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pickupLocationId" TEXT,
ADD COLUMN     "pickupScheduledAt" TIMESTAMP(3),
ADD COLUMN     "provider" VARCHAR(20) NOT NULL DEFAULT 'manual',
ADD COLUMN     "providerOrderId" VARCHAR(40),
ADD COLUMN     "providerShipmentId" VARCHAR(40),
ADD COLUMN     "providerStatus" VARCHAR(80),
ADD COLUMN     "providerStatusCode" INTEGER,
ADD COLUMN     "reference" VARCHAR(50),
ADD COLUMN     "weightGrams" INTEGER;

-- CreateTable
CREATE TABLE "ShipmentEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" "ShipmentStatus",
    "providerStatus" VARCHAR(80),
    "providerStatusCode" INTEGER,
    "activity" VARCHAR(300),
    "location" VARCHAR(200),
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" VARCHAR(10) NOT NULL,
    "dedupeHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupLocation" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "contactName" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "email" VARCHAR(120) NOT NULL,
    "line1" VARCHAR(200) NOT NULL,
    "line2" VARCHAR(200),
    "city" VARCHAR(80) NOT NULL,
    "stateCode" VARCHAR(2) NOT NULL,
    "pincode" VARCHAR(6) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "dedupeKey" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "processingError" VARCHAR(500),
    "note" VARCHAR(200),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentEvent_dedupeHash_key" ON "ShipmentEvent"("dedupeHash");

-- CreateIndex
CREATE INDEX "ShipmentEvent_shipmentId_occurredAt_idx" ON "ShipmentEvent"("shipmentId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PickupLocation_name_key" ON "PickupLocation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_dedupeKey_key" ON "WebhookEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_receivedAt_idx" ON "WebhookEvent"("provider", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_reference_key" ON "Shipment"("reference");

-- CreateIndex
CREATE INDEX "Shipment_provider_status_idx" ON "Shipment"("provider", "status");

-- CreateIndex
CREATE INDEX "Shipment_trackingNumber_idx" ON "Shipment"("trackingNumber");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "PickupLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

