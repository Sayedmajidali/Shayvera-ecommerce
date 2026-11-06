import { z } from "zod";
import { ok, parseSearchParams } from "@/lib/api";
import { paginationSchema } from "@/lib/validation/common";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { listCustomers } from "@/server/modules/customers/admin-customers";

const schema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

export const GET = adminRoute(
  "CUSTOMERS_VIEW",
  async (req) => ok(await listCustomers(parseSearchParams(req.url, schema))),
  { csrf: false },
);
