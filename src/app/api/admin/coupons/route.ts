import { ok, parseJson } from "@/lib/api";
import { adminRoute } from "@/server/auth/admin-route";
import { couponInputSchema, listCoupons, saveCoupon } from "@/server/services/admin-misc";

export const GET = adminRoute(async () => ok(await listCoupons()), { csrf: false });

export const POST = adminRoute(async (req, _ctx, { actor }) =>
  ok(await saveCoupon(null, await parseJson(req, couponInputSchema), actor), 201),
);
