import type { Metadata } from "next";
import { CouponManager } from "@/components/admin/coupon-manager";
import { AdminPageHeader } from "@/components/admin/page-header";
import { listCoupons } from "@/server/modules/coupons/coupon-admin";
import { requireAdminPage } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "Coupons" };

export default async function CouponsPage() {
  // Each page authorizes itself: layouts are not re-rendered on client-side navigation.
  await requireAdminPage("COUPONS_MANAGE");
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
