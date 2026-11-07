-- At most one active (not cancelled/failed) provider delivery shipment per order, so concurrent
-- "Create shipment" clicks or retries cannot book two parcels. Manual shipments are exempt.
CREATE UNIQUE INDEX "Shipment_one_active_provider_delivery" ON "Shipment"("orderId")
  WHERE "provider" <> 'manual' AND "isReturn" = false AND "status" NOT IN ('CANCELLED', 'FAILED');

-- Only one default pickup location.
CREATE UNIQUE INDEX "PickupLocation_one_default" ON "PickupLocation"("isDefault") WHERE "isDefault" = true;

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_package_positive"
  CHECK (("weightGrams" IS NULL OR "weightGrams" > 0) AND ("codAmountPaise" IS NULL OR "codAmountPaise" >= 0));
