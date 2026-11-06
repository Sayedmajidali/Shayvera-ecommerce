import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { addShipment, shipmentSchema } from "@/server/modules/orders/admin-orders";

export const POST = adminRoute<RouteCtx<{ id: string }>>(
  "SHIPPING_MANAGE",
  async (req, { params }, { actor }) => {
    const input = await parseJson(req, shipmentSchema);
    await addShipment((await params).id, input, actor);
    return ok({ added: true }, 201);
  },
);
