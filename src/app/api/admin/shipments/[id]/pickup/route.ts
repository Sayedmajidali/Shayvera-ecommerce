import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { pickupSchema, schedulePickup } from "@/server/modules/shipping/shipments";

export const POST = adminRoute<RouteCtx<{ id: string }>>(
  "SHIPPING_MANAGE",
  async (req, { params }, { actor }) => {
    const { date } = await parseJson(req, pickupSchema);
    await schedulePickup((await params).id, date, actor);
    return ok({ scheduled: true });
  },
);
