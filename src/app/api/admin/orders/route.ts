import { ok, parseSearchParams } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { adminOrderFiltersSchema, listOrdersAdmin } from "@/server/modules/orders/admin-orders";

export const GET = adminRoute(
  "ORDERS_VIEW",
  async (req) => ok(await listOrdersAdmin(parseSearchParams(req.url, adminOrderFiltersSchema))),
  { csrf: false },
);
