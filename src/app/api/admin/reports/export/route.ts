import { z } from "zod";
import { parseSearchParams } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { audit } from "@/server/modules/audit/audit";
import {
  buildReportCsv,
  REPORT_EXPORTS,
  reportRangeSchema,
} from "@/server/modules/analytics/reports";

/** CSV download of one report for a date range (India time, `to` inclusive). Audit-logged. */
export const GET = adminRoute(
  "REPORTS_VIEW",
  async (req, _ctx, { actor }) => {
    const { report, from, to } = parseSearchParams(
      req.url,
      z.object({
        report: z.enum(REPORT_EXPORTS),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
    );
    const range = reportRangeSchema.parse({ from, to });
    const { csv, filename } = await buildReportCsv(report, range);
    await audit({
      actorId: actor.id,
      action: "report.export",
      entityType: "Report",
      entityId: report,
      metadata: { from: range.from, to: range.to },
      ipAddress: actor.ip,
    });
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  },
  { csrf: false },
);
