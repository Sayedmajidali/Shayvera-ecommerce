import { z } from "zod";
import { ok, parseSearchParams } from "@/lib/api";
import { paginationSchema } from "@/lib/validation/common";
import { adminRoute } from "@/server/auth/admin-route";
import { listCustomers } from "@/server/services/admin-misc";

const schema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

export const GET = adminRoute(
  async (req) => ok(await listCustomers(parseSearchParams(req.url, schema))),
  { csrf: false },
);
