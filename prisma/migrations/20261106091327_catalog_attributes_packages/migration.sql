-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "sourceRef" VARCHAR(200);

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "breadthMm" INTEGER,
ADD COLUMN     "heightMm" INTEGER,
ADD COLUMN     "lengthMm" INTEGER;

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "defaultPackageBreadthMm" INTEGER NOT NULL DEFAULT 150,
ADD COLUMN     "defaultPackageHeightMm" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "defaultPackageLengthMm" INTEGER NOT NULL DEFAULT 200,
ADD COLUMN     "defaultPackageWeightGrams" INTEGER NOT NULL DEFAULT 500;

-- CreateTable
CREATE TABLE "ProductAttribute" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "value" VARCHAR(300) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductAttribute_productId_sortOrder_idx" ON "ProductAttribute"("productId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sourceRef_key" ON "Product"("sourceRef");

-- AddForeignKey
ALTER TABLE "ProductAttribute" ADD CONSTRAINT "ProductAttribute_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Package values must be positive when present (grams / millimetres).
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_package_positive"
  CHECK (("weightGrams" IS NULL OR "weightGrams" > 0)
     AND ("lengthMm" IS NULL OR "lengthMm" > 0)
     AND ("breadthMm" IS NULL OR "breadthMm" > 0)
     AND ("heightMm" IS NULL OR "heightMm" > 0));
ALTER TABLE "StoreSettings" ADD CONSTRAINT "StoreSettings_default_package_positive"
  CHECK ("defaultPackageWeightGrams" > 0 AND "defaultPackageLengthMm" > 0
     AND "defaultPackageBreadthMm" > 0 AND "defaultPackageHeightMm" > 0);
