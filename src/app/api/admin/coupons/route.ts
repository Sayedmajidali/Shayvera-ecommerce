import { ok, parseJson } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { couponInputSchema, listCoupons, saveCoupon } from "@/server/modules/coupons/coupon-admin";

export const GET = adminRoute("COUPONS_MANAGE", async () => ok(await listCoupons()), {
  csrf: false,
});

export const POST = adminRoute("COUPONS_MANAGE", async (req, _ctx, { actor }) =>
  ok(await saveCoupon(null, await parseJson(req, couponInputSchema), actor), 201),
);
