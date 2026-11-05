import type { Metadata } from "next";
import { CouponManager } from "@/components/admin/coupon-manager";
import { AdminPageHeader } from "@/components/admin/page-header";
import { listCoupons } from "@/server/services/admin-misc";

export const metadata: Metadata = { title: "Coupons" };

export default async function CouponsPage() {
  const coupons = await listCoupons();
  return (
    <>
      <AdminPageHeader
        title="Coupons"
        description="Percentage and fixed discounts with minimums, caps, limits and validity windows."
      />
      <CouponManager
        coupons={coupons.map((c) => ({
          ...c,
          startsAt: c.startsAt?.toISOString() ?? null,
          expiresAt: c.expiresAt?.toISOString() ?? null,
        }))}
      />
    </>
  );
}
