-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "countryOfOrigin" TEXT NOT NULL DEFAULT 'India',
ADD COLUMN     "ingredients" TEXT,
ADD COLUMN     "isVegetarian" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "shelfLife" TEXT,
ADD COLUMN     "storageInfo" TEXT;

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "fssaiLicense" VARCHAR(14),
ALTER COLUMN "storeName" SET DEFAULT 'Shayvera Foods',
ALTER COLUMN "supportEmail" SET DEFAULT 'support@example.com';
