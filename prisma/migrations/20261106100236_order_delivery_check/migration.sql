-- CreateEnum
CREATE TYPE "DeliveryCheck" AS ENUM ('SERVICEABLE', 'UNVERIFIED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryCheck" "DeliveryCheck" NOT NULL DEFAULT 'SKIPPED',
ADD COLUMN     "deliveryEtaDays" INTEGER;

