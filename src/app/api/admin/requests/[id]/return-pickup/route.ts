import { ok, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { requestReturnPickup } from "@/server/modules/shipping/shipments";

/** Books a courier pickup of the returned items from the customer (approved returns). */
export const POST = adminRoute<RouteCtx<{ id: string }>>(
  ["RETURNS_MANAGE", "SHIPPING_MANAGE"],
  async (_req, { params }, { actor }) =>
    ok(await requestReturnPickup((await params).id, actor), 201),
);
