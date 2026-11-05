import { z } from "zod";
import { ok, parseSearchParams } from "@/lib/api";
import { adminRoute } from "@/server/auth/admin-route";
import { getDashboardStats } from "@/server/services/analytics";

export const GET = adminRoute(
  async (req) => {
    const { range } = parseSearchParams(
      req.url,
      z.object({ range: z.enum(["7d", "30d", "90d"]).default("30d") }),
    );
    return ok(await getDashboardStats(range));
  },
  { csrf: false },
);
