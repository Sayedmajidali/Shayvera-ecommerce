import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/auth/admin-route";
import { couponInputSchema, deleteCoupon, saveCoupon } from "@/server/services/admin-misc";

type Ctx = RouteCtx<{ id: string }>;

export const PUT = adminRoute<Ctx>(async (req, { params }, { actor }) =>
  ok(await saveCoupon((await params).id, await parseJson(req, couponInputSchema), actor)),
);

/** Deletes unused coupons; used coupons are deactivated to keep order history intact. */
export const DELETE = adminRoute<Ctx>(async (_req, { params }, { actor }) =>
  ok(await deleteCoupon((await params).id, actor)),
);
