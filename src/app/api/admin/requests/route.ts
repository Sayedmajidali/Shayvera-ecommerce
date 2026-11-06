import { ok, parseSearchParams } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { listRequests, requestListSchema } from "@/server/modules/orders/requests";

export const GET = adminRoute(
  "RETURNS_MANAGE",
  async (req) => ok(await listRequests(parseSearchParams(req.url, requestListSchema))),
  { csrf: false },
);
