-- CreateIndex
CREATE INDEX "Invoice_issuedAt_idx" ON "Invoice"("issuedAt");

-- CreateIndex
CREATE INDEX "Order_placedAt_idx" ON "Order"("placedAt");

-- CreateIndex
CREATE INDEX "Payment_status_capturedAt_idx" ON "Payment"("status", "capturedAt");

-- CreateIndex
CREATE INDEX "Refund_status_createdAt_idx" ON "Refund"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_processedAt_idx" ON "Refund"("processedAt");

-- CreateIndex
CREATE INDEX "Shipment_status_updatedAt_idx" ON "Shipment"("status", "updatedAt");


-- Partial indexes for "needs attention" work queues (small, only flagged rows are indexed).
CREATE INDEX "Order_requires_attention_idx" ON "Order"("updatedAt") WHERE "requiresAttention";
CREATE INDEX "Shipment_needs_attention_idx" ON "Shipment"("updatedAt") WHERE "needsAttention";
CREATE INDEX "PaymentEvent_unprocessed_idx" ON "PaymentEvent"("receivedAt") WHERE "processedAt" IS NULL;
