import { z } from "zod";
import { ok, parseSearchParams, route } from "@/lib/api";
import { requireUser } from "@/server/auth/session";
import { listCustomerOrders } from "@/server/services/orders";

export const GET = route(
  async (req) => {
    const user = await requireUser(req);
    const { page } = parseSearchParams(
      req.url,
      z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) }),
    );
    return ok(await listCustomerOrders(user.id, page));
  },
  { csrf: false },
);
