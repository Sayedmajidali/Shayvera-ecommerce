import { z } from "zod";
import { ok, parseSearchParams } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { getDashboardStats } from "@/server/modules/analytics/dashboard";

export const GET = adminRoute(
  "DASHBOARD_VIEW",
  async (req) => {
    const { range } = parseSearchParams(
      req.url,
      z.object({ range: z.enum(["7d", "30d", "90d"]).default("30d") }),
    );
    return ok(await getDashboardStats(range));
  },
  { csrf: false },
);
