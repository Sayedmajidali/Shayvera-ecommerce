import { ok, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { resolveAttention } from "@/server/modules/orders/admin-orders";

export const DELETE = adminRoute<RouteCtx<{ id: string }>>(async (_req, { params }, { actor }) => {
  await resolveAttention((await params).id, actor);
  return ok({ resolved: true });
});
