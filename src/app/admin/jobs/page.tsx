import type { Metadata } from "next";
import { Activity, CheckCircle2, Clock, Skull } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FilterBar } from "@/components/admin/filter-bar";
import { AdminPageHeader } from "@/components/admin/page-header";
import { RetryEventButton } from "@/components/admin/retry-event-button";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusBadge } from "@/components/admin/status-badge";
import { firstValues } from "@/lib/search-params";
import { requireAdminPage } from "@/server/modules/auth/session";
import {
  getJobsDashboard,
  getSystemStatus,
  jobListSchema,
} from "@/server/modules/operations/jobs-dashboard";

export const metadata: Metadata = { title: "Background jobs" };

const dt = (d: Date) =>
  d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

function age(ms: number) {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 3_600_000)} h`;
}

export default async function JobsPage({ searchParams }: PageProps<"/admin/jobs">) {
  await requireAdminPage("JOBS_MANAGE");
  const f = jobListSchema.parse(firstValues(await searchParams));
  const [d, status] = await Promise.all([getJobsDashboard(f), getSystemStatus()]);
  return (
    <>
      <AdminPageHeader
        title="Background jobs"
        description="Integration status, and the queue that runs emails, webhooks, refunds, courier bookings and scheduled checks. Failed jobs retry automatically with backoff; dead jobs need a decision."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="job-tiles">
        <StatTile
          icon={Activity}
          label="Worker"
          value={d.workerHealthy ? "Running" : "Not seen"}
          hint={d.heartbeat ? `Last heartbeat ${dt(d.heartbeat.at)}` : "No heartbeat recorded"}
          tone={d.workerHealthy ? undefined : "warning"}
        />
        <StatTile
          icon={Clock}
          label="Waiting"
          value={String(d.stats.queued)}
          hint={
            d.stats.oldestDueAgeMs > 0
              ? `Oldest due ${age(d.stats.oldestDueAgeMs)} ago`
              : "Nothing overdue"
          }
          tone={d.stats.oldestDueAgeMs > 10 * 60_000 ? "warning" : undefined}
        />
        <StatTile
          icon={CheckCircle2}
          label="Done (24 h)"
          value={String(d.succeeded24h)}
          hint={`${d.stats.running} running now`}
        />
        <StatTile
          icon={Skull}
          label="Dead"
          value={String(d.stats.dead)}
          hint="Out of attempts"
          tone={d.stats.dead > 0 ? "warning" : undefined}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>System status</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table data-testid="system-status">
            <TableBody>
              {status.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="pl-5 font-medium">{r.name}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center gap-1.5 text-sm ${r.level === "warn" ? "font-medium" : ""}`}
                    >
                      <span
                        aria-hidden
                        className={`size-2 rounded-full ${r.level === "ok" ? "bg-success" : r.level === "warn" ? "bg-warning" : "bg-muted-foreground"}`}
                      />
                      <span className="sr-only">
                        {r.level === "ok"
                          ? "OK: "
                          : r.level === "warn"
                            ? "Needs attention: "
                            : "Off: "}
                      </span>
                      {r.value}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground pr-5 text-xs">{r.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {d.failingTypes.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Failing job types</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            {d.failingTypes.map((t) => (
              <span key={`${t.type}-${t.status}`} className="rounded-full border px-3 py-1">
                <span className="font-mono text-xs">{t.type}</span> · {t.count}{" "}
                {t.status.toLowerCase()}
              </span>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mt-6 gap-0 py-0">
        <CardHeader className="py-4">
          <CardTitle>{f.status ? "Jobs" : "Failed and dead jobs"}</CardTitle>
        </CardHeader>
        <FilterBar
          search={false}
          selects={[
            {
              name: "status",
              label: "Statuses",
              options: ["QUEUED", "RUNNING", "FAILED", "DEAD", "SUCCEEDED"].map((s) => ({
                value: s,
                label: s.charAt(0) + s.slice(1).toLowerCase(),
              })),
            },
            { name: "type", label: "Types", options: d.types.map((t) => ({ value: t, label: t })) },
          ]}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Last error</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.jobs.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-8 text-center text-sm">
                  Nothing here — all jobs are healthy.
                </TableCell>
              </TableRow>
            )}
            {d.jobs.map((j) => (
              <TableRow key={j.id} data-testid="job-row">
                <TableCell className="font-mono text-xs">{j.type}</TableCell>
                <TableCell>
                  <StatusBadge status={j.status} />
                </TableCell>
                <TableCell className="tabular-nums">
                  {j.attempts}/{j.maxAttempts}
                </TableCell>
                <TableCell
                  className="text-muted-foreground max-w-sm truncate text-xs"
                  title={j.lastError ?? undefined}
                >
                  {j.lastError ?? "—"}
                </TableCell>
                <TableCell className="text-sm">{dt(j.updatedAt)}</TableCell>
                <TableCell className="text-right">
                  {(j.status === "DEAD" || j.status === "FAILED") && (
                    <RetryEventButton url={`/api/admin/jobs/${j.id}/retry`} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
