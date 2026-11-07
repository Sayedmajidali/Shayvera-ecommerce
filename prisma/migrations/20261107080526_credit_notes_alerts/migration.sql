-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "alertEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "autoIssueInvoice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "creditNotePrefix" TEXT NOT NULL DEFAULT 'CN';

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_refundId_key" ON "CreditNote"("refundId");

-- CreateIndex
CREATE INDEX "CreditNote_orderId_idx" ON "CreditNote"("orderId");

-- CreateIndex
CREATE INDEX "CreditNote_issuedAt_idx" ON "CreditNote"("issuedAt");

-- CreateIndex
CREATE INDEX "Refund_requestId_idx" ON "Refund"("requestId");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "OrderRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- One live refund per return request: a second refund for the same return is refused unless the
-- earlier attempt failed.
CREATE UNIQUE INDEX "Refund_one_live_per_request" ON "Refund"("requestId")
  WHERE "requestId" IS NOT NULL AND "status" <> 'FAILED';

ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_amount_positive" CHECK ("amountPaise" > 0);
