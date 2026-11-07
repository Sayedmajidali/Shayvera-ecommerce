import { ok, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { retryShipmentCreation } from "@/server/modules/shipping/shipments";

export const POST = adminRoute<RouteCtx<{ id: string }>>(
  "SHIPPING_MANAGE",
  async (_req, { params }, { actor }) => {
    await retryShipmentCreation((await params).id, actor);
    return ok({ queued: true });
  },
);
