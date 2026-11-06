-- CreateEnum
CREATE TYPE "AdminPermission" AS ENUM ('DASHBOARD_VIEW', 'REPORTS_VIEW', 'ORDERS_VIEW', 'ORDERS_MANAGE', 'PAYMENTS_VIEW', 'PAYMENTS_REFUND', 'SHIPPING_MANAGE', 'RETURNS_MANAGE', 'CATALOG_MANAGE', 'INVENTORY_MANAGE', 'CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE', 'COUPONS_MANAGE', 'SETTINGS_MANAGE', 'MESSAGES_VIEW', 'AUDIT_VIEW', 'JOBS_MANAGE', 'ADMINS_MANAGE');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "adminRoleId" TEXT;

-- CreateTable
CREATE TABLE "AdminRole" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300),
    "permissions" "AdminPermission"[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminRole_name_key" ON "AdminRole"("name");

-- CreateIndex
CREATE INDEX "user_adminRoleId_idx" ON "user"("adminRoleId");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_adminRoleId_fkey" FOREIGN KEY ("adminRoleId") REFERENCES "AdminRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Built-in roles (ids fixed so code and seeds can reference them). Owner gets every permission.
INSERT INTO "AdminRole" ("id", "name", "description", "permissions", "isSystem", "updatedAt") VALUES
  ('role_owner', 'Owner', 'Full access, including staff and role management.',
   ARRAY['DASHBOARD_VIEW','REPORTS_VIEW','ORDERS_VIEW','ORDERS_MANAGE','PAYMENTS_VIEW','PAYMENTS_REFUND','SHIPPING_MANAGE','RETURNS_MANAGE','CATALOG_MANAGE','INVENTORY_MANAGE','CUSTOMERS_VIEW','CUSTOMERS_MANAGE','COUPONS_MANAGE','SETTINGS_MANAGE','MESSAGES_VIEW','AUDIT_VIEW','JOBS_MANAGE','ADMINS_MANAGE']::"AdminPermission"[], true, NOW()),
  ('role_operations', 'Operations', 'Process orders, shipments, returns and stock.',
   ARRAY['DASHBOARD_VIEW','ORDERS_VIEW','ORDERS_MANAGE','PAYMENTS_VIEW','SHIPPING_MANAGE','RETURNS_MANAGE','INVENTORY_MANAGE','CUSTOMERS_VIEW','MESSAGES_VIEW','JOBS_MANAGE']::"AdminPermission"[], true, NOW()),
  ('role_catalog', 'Catalog', 'Manage products, categories, stock and coupons.',
   ARRAY['DASHBOARD_VIEW','CATALOG_MANAGE','INVENTORY_MANAGE','COUPONS_MANAGE']::"AdminPermission"[], true, NOW()),
  ('role_support', 'Support', 'Look up orders and customers; handle returns.',
   ARRAY['DASHBOARD_VIEW','ORDERS_VIEW','PAYMENTS_VIEW','RETURNS_MANAGE','CUSTOMERS_VIEW','MESSAGES_VIEW']::"AdminPermission"[], true, NOW()),
  ('role_accounts', 'Accounts', 'Payments, refunds and reports.',
   ARRAY['DASHBOARD_VIEW','REPORTS_VIEW','ORDERS_VIEW','PAYMENTS_VIEW','PAYMENTS_REFUND','CUSTOMERS_VIEW','AUDIT_VIEW']::"AdminPermission"[], true, NOW())
ON CONFLICT ("id") DO NOTHING;

-- Existing administrators keep full access.
UPDATE "user" SET "adminRoleId" = 'role_owner' WHERE "role" = 'ADMIN' AND "adminRoleId" IS NULL;
