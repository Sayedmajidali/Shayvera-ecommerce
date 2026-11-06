import { ok, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { reconcileOrderAdmin } from "@/server/modules/orders/admin-orders";

export const POST = adminRoute<RouteCtx<{ id: string }>>(
  "ORDERS_MANAGE",
  async (_req, { params }, { actor }) =>
    ok({ result: await reconcileOrderAdmin((await params).id, actor) }),
);
