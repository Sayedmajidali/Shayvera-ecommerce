import { ok, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { getOrderAdmin } from "@/server/modules/orders/admin-orders";

export const GET = adminRoute<RouteCtx<{ id: string }>>(
  "ORDERS_VIEW",
  async (_req, { params }) => ok(await getOrderAdmin((await params).id)),
  { csrf: false },
);
