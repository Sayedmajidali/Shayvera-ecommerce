import type { Job } from "@prisma/client";
import { runWithContext } from "@/server/platform/context";
import { logger } from "@/server/platform/logger";
import { captureException } from "@/server/platform/monitoring";
import {
  claimJobs,
  completeJob,
  failJob,
  PermanentJobError,
  WORKER_ID,
  type JobPayloads,
  type JobType,
} from "./queue";

export type JobContext = {
  jobId: string;
  attempt: number;
  maxAttempts: number;
  /** True when a failure now would make the job DEAD. */
  isLastAttempt: boolean;
};

export type JobHandler<T extends JobType> = (
  payload: JobPayloads[T],
  ctx: JobContext,
) => Promise<void>;

const handlers = new Map<string, JobHandler<JobType>>();

export function registerJob<T extends JobType>(type: T, handler: JobHandler<T>) {
  handlers.set(type, handler as JobHandler<JobType>);
}

export function registeredJobTypes() {
  return [...handlers.keys()];
}

async function execute(job: Job, workerId: string) {
  const handler = handlers.get(job.type);
  await runWithContext(
    { requestId: job.requestId ?? job.id, jobId: job.id, jobType: job.type },
    async () => {
      const started = Date.now();
      try {
        if (!handler)
          throw new PermanentJobError(`No handler registered for job type "${job.type}"`);
        await handler(job.payload as JobPayloads[JobType], {
          jobId: job.id,
          attempt: job.attempts,
          maxAttempts: job.maxAttempts,
          isLastAttempt: job.attempts >= job.maxAttempts,
        });
        await completeJob(job.id, workerId);
        logger.info("Job succeeded", { attempt: job.attempts, ms: Date.now() - started });
      } catch (error) {
        const outcome = await failJob(job, error, workerId);
        if (outcome === "dead") {
          captureException(error, { message: "Job moved to dead-letter", attempt: job.attempts });
        } else {
          logger.warn("Job failed; will retry", { attempt: job.attempts, error });
        }
      }
    },
  );
}

/**
 * Claims and runs due jobs until none are left (or `maxJobs` is reached). Used by the worker loop,
 * the optional in-process runner and tests.
 */
export async function runDueJobs(
  opts: { batchSize?: number; maxJobs?: number; workerId?: string } = {},
) {
  const workerId = opts.workerId ?? WORKER_ID;
  const types = registeredJobTypes();
  let processed = 0;
  const max = opts.maxJobs ?? Infinity;
  while (processed < max) {
    const batch = await claimJobs(Math.min(opts.batchSize ?? 10, max - processed), workerId, types);
    if (batch.length === 0) break;
    for (const job of batch) await execute(job, workerId);
    processed += batch.length;
  }
  return processed;
}
