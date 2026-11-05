import { ok, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/auth/admin-route";
import { reconcileOrderAdmin } from "@/server/services/admin-orders";

export const POST = adminRoute<RouteCtx<{ id: string }>>(async (_req, { params }, { actor }) =>
  ok({ result: await reconcileOrderAdmin((await params).id, actor) }),
);
