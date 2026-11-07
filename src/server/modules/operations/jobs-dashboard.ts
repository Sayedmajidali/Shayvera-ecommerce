import "server-only";
import { z } from "zod";
import type { JobStatus, Prisma } from "@prisma/client";
import { db } from "@/server/platform/db";
import { queueStats } from "@/server/platform/jobs/queue";
import { readHeartbeat } from "@/server/platform/jobs/scheduler";

export const jobListSchema = z.object({
  status: z.enum(["QUEUED", "RUNNING", "FAILED", "DEAD", "SUCCEEDED"]).optional().catch(undefined),
  type: z.string().trim().max(60).optional().catch(undefined),
});

/** Admin → Background jobs: queue health, failing job types and the jobs needing a retry. Read-only. */
export async function getJobsDashboard(f: z.infer<typeof jobListSchema>) {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const where: Prisma.JobWhereInput = {
    status: f.status ? (f.status as JobStatus) : { in: ["DEAD", "FAILED"] },
    ...(f.type ? { type: f.type } : {}),
  };
  const [stats, heartbeat, failingTypes, succeeded24h, jobs, types] = await Promise.all([
    queueStats(),
    readHeartbeat(),
    db.job.groupBy({
      by: ["type", "status"],
      where: { status: { in: ["DEAD", "FAILED"] } },
      _count: { _all: true },
    }),
    db.job.count({ where: { status: "SUCCEEDED", finishedAt: { gte: dayAgo } } }),
    db.job.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 100,
      // Payloads are not shown: they can hold order ids and email addresses.
      select: {
        id: true,
        type: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        runAt: true,
        lastError: true,
        updatedAt: true,
      },
    }),
    db.job.findMany({ distinct: ["type"], select: { type: true }, orderBy: { type: "asc" } }),
  ]);
  return {
    stats,
    heartbeat,
    workerHealthy: heartbeat !== null && Date.now() - heartbeat.at.getTime() < 2 * 60_000,
    succeeded24h,
    failingTypes: failingTypes.map((t) => ({
      type: t.type,
      status: t.status,
      count: t._count._all,
    })),
    jobs,
    types: types.map((t) => t.type),
  };
}
