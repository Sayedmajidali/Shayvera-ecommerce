import { WORKER_ID, requeueStuckJobs } from "@/server/platform/jobs/queue";
import { runDueJobs } from "@/server/platform/jobs/runner";
import { enqueueScheduled, writeHeartbeat } from "@/server/platform/jobs/scheduler";
import { logger } from "@/server/platform/logger";
import { registerAllJobs, SCHEDULES } from "@/server/jobs";

export type JobLoop = { stop: () => Promise<void> };

/**
 * Polls the queue until stopped. Each tick: heartbeat, enqueue due periodic jobs, run due jobs.
 * `stop()` waits for the in-flight tick, so a deploy never abandons a job half-way (and if the
 * process is killed anyway, the stuck-lock sweep returns the job to the queue).
 */
export function startJobLoop(opts: { pollMs?: number; label: string }): JobLoop {
  registerAllJobs();
  const pollMs = opts.pollMs ?? 2_000;
  let stopped = false;
  let current: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  let lastStuckSweep = 0;

  const tick = async () => {
    try {
      await writeHeartbeat(`${opts.label}:${WORKER_ID}`);
      await enqueueScheduled(SCHEDULES);
      if (Date.now() - lastStuckSweep > 60_000) {
        lastStuckSweep = Date.now();
        await requeueStuckJobs();
      }
      await runDueJobs({ maxJobs: 50 });
    } catch (error) {
      logger.error("Job loop tick failed", { error });
    }
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      current = tick().finally(schedule);
    }, pollMs);
    timer.unref?.();
  };
  current = tick().finally(schedule);
  logger.info("Job loop started", { label: opts.label, workerId: WORKER_ID, pollMs });

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await current;
    },
  };
}
