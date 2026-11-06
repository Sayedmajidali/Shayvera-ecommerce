import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { couponInputSchema, deleteCoupon, saveCoupon } from "@/server/modules/coupons/coupon-admin";

type Ctx = RouteCtx<{ id: string }>;

export const PUT = adminRoute<Ctx>("COUPONS_MANAGE", async (req, { params }, { actor }) =>
  ok(await saveCoupon((await params).id, await parseJson(req, couponInputSchema), actor)),
);

/** Deletes unused coupons; used coupons are deactivated to keep order history intact. */
export const DELETE = adminRoute<Ctx>("COUPONS_MANAGE", async (_req, { params }, { actor }) =>
  ok(await deleteCoupon((await params).id, actor)),
);
