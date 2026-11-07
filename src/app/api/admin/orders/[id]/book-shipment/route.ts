import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { createShipmentSchema, requestShipment } from "@/server/modules/shipping/shipments";

/** Books the order's parcel with the courier (queued; AWB follows). 409 if a shipment is active. */
export const POST = adminRoute<RouteCtx<{ id: string }>>(
  "SHIPPING_MANAGE",
  async (req, { params }, { actor }) =>
    ok(
      await requestShipment((await params).id, await parseJson(req, createShipmentSchema), actor),
      201,
    ),
);
