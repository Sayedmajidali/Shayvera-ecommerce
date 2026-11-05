import { ok, parseSearchParams } from "@/lib/api";
import { adminRoute } from "@/server/auth/admin-route";
import { adminOrderFiltersSchema, listOrdersAdmin } from "@/server/services/admin-orders";

export const GET = adminRoute(
  async (req) => ok(await listOrdersAdmin(parseSearchParams(req.url, adminOrderFiltersSchema))),
  { csrf: false },
);
