import { z } from "zod";
import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { trimmed } from "@/lib/validation/common";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { cancelShipment } from "@/server/modules/shipping/shipments";

const body = z.object({ reason: trimmed(3, 200, "Reason") });

/** Cancels a booking before the courier picks it up (the order itself is unchanged). */
export const POST = adminRoute<RouteCtx<{ id: string }>>(
  "SHIPPING_MANAGE",
  async (req, { params }, { actor }) => {
    const { reason } = await parseJson(req, body);
    await cancelShipment((await params).id, reason, actor);
    return ok({ cancelled: true });
  },
);
