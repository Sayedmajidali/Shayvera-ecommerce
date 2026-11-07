-- AlterTable
ALTER TABLE "InventoryTransaction" ADD COLUMN     "idempotencyKey" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_idempotencyKey_key" ON "InventoryTransaction"("idempotencyKey");

