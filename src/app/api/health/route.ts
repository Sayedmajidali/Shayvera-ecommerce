import { db } from "@/server/platform/db";
import { logger } from "@/server/platform/logger";
import { queueStats } from "@/server/platform/jobs/queue";
import { readHeartbeat } from "@/server/platform/jobs/scheduler";
import { jobRunnerMode } from "@/lib/env";

export const dynamic = "force-dynamic";

const HEARTBEAT_STALE_MS = 2 * 60_000;
const BACKLOG_STALE_MS = 15 * 60_000;

/**
 * Readiness probe: database, job queue backlog and worker heartbeat. Returns 503 only when the
 * database is unreachable (the web tier cannot serve); a stale worker or backlog is reported as
 * "degraded" with 200 so load balancers keep routing while operators are alerted.
 * Exposes no versions, hostnames or configuration values.
 */
export async function GET() {
  const started = Date.now();
  const time = new Date().toISOString();
  const headers = { "Cache-Control": "no-store" };
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    logger.error("Health check failed", { error });
    return Response.json({ status: "down", database: "down", time }, { status: 503, headers });
  }
  const dbLatencyMs = Date.now() - started;

  const mode = jobRunnerMode();
  let jobs: Record<string, unknown>;
  let healthy: boolean;
  try {
    const [stats, heartbeat] = await Promise.all([queueStats(), readHeartbeat()]);
    const workerAgeMs = heartbeat ? Date.now() - heartbeat.at.getTime() : null;
    const workerUp = mode === "off" || (workerAgeMs !== null && workerAgeMs < HEARTBEAT_STALE_MS);
    healthy = workerUp && stats.oldestDueAgeMs < BACKLOG_STALE_MS;
    jobs = {
      runner: mode,
      worker: mode === "off" ? "disabled" : workerUp ? "up" : "stale",
      lastHeartbeatAgeMs: workerAgeMs,
      queued: stats.queued,
      running: stats.running,
      dead: stats.dead,
      oldestDueAgeMs: stats.oldestDueAgeMs,
    };
  } catch (error) {
    // e.g. migrations not yet applied: the web tier can still answer, but report it.
    logger.warn("Job queue health check failed", { error });
    healthy = false;
    jobs = { runner: mode, worker: "unknown" };
  }

  return Response.json(
    { status: healthy ? "ok" : "degraded", database: "up", dbLatencyMs, jobs, time },
    { headers },
  );
}
