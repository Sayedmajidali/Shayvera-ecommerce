import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/auth/admin-route";
import { refundOrderAdmin, refundSchema } from "@/server/services/admin-orders";

export const POST = adminRoute<RouteCtx<{ id: string }>>(async (req, { params }, { actor }) => {
  const input = await parseJson(req, refundSchema);
  return ok(await refundOrderAdmin((await params).id, input, actor), 201);
});
