import { registerJob } from "@/server/platform/jobs/runner";
import { pruneJobs, requeueStuckJobs } from "@/server/platform/jobs/queue";
import type { Schedule } from "@/server/platform/jobs/scheduler";
import { logger } from "@/server/platform/logger";
import { db } from "@/server/platform/db";
import { deliverNotification } from "@/server/modules/notifications/notifications";
import { expireStalePendingOrders } from "@/server/modules/payments/payments";

/**
 * Composition root for background work: every job type and periodic schedule is listed here, so
 * the worker, the in-process runner and the tests all register the same handlers.
 */
declare module "@/server/platform/jobs/queue" {
  interface JobPayloads {
    "payments.expire-unpaid": Record<string, never>;
    "maintenance.cleanup": Record<string, never>;
  }
}

let registered = false;

export function registerAllJobs() {
  if (registered) return;
  registered = true;

  registerJob("notification.send", (p, ctx) => deliverNotification(p.notificationId, ctx));

  registerJob("payments.expire-unpaid", async () => {
    const r = await expireStalePendingOrders(200);
    if (r.checked) logger.info("Expired unpaid orders", r);
  });

  registerJob("maintenance.cleanup", async () => {
    const stuck = await requeueStuckJobs();
    const pruned = await pruneJobs(14);
    // Expired sessions, verification tokens and stale rate-limit windows accumulate otherwise.
    const now = new Date();
    const [sessions, verifications, buckets] = await Promise.all([
      db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      db.verification.deleteMany({ where: { expiresAt: { lt: now } } }),
      db.rateLimitBucket.deleteMany({
        where: { windowStart: { lt: new Date(now.getTime() - 86_400_000) } },
      }),
    ]);
    logger.info("Maintenance completed", {
      ...stuck,
      prunedJobs: pruned,
      expiredSessions: sessions.count,
      expiredVerifications: verifications.count,
      staleRateLimitBuckets: buckets.count,
    });
  });
}

export const SCHEDULES: Schedule[] = [
  { type: "payments.expire-unpaid", everyMs: 2 * 60_000, payload: {} },
  { type: "maintenance.cleanup", everyMs: 60 * 60_000, payload: {} },
];
