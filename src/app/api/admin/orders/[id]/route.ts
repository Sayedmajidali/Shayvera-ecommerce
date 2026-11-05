import { ok, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/auth/admin-route";
import { getOrderAdmin } from "@/server/services/admin-orders";

export const GET = adminRoute<RouteCtx<{ id: string }>>(
  async (_req, { params }) => ok(await getOrderAdmin((await params).id)),
  { csrf: false },
);
