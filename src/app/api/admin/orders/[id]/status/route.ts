import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { statusUpdateSchema, updateOrderStatusAdmin } from "@/server/modules/orders/admin-orders";

export const POST = adminRoute<RouteCtx<{ id: string }>>(async (req, { params }, { actor }) => {
  const input = await parseJson(req, statusUpdateSchema);
  return ok(await updateOrderStatusAdmin((await params).id, input, actor));
});
