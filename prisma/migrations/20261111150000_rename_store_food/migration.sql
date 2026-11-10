-- Brand rename: "Shayvera Foods" → "Shayvera Food".
ALTER TABLE "StoreSettings" ALTER COLUMN "storeName" SET DEFAULT 'Shayvera Food';
-- Only values still carrying the old default/brand are changed (custom names are left alone).
UPDATE "StoreSettings" SET "storeName" = 'Shayvera Food', "updatedAt" = NOW() WHERE "storeName" = 'Shayvera Foods';
UPDATE "Product" SET "brand" = 'Shayvera Food', "updatedAt" = NOW() WHERE "brand" = 'Shayvera Foods';
