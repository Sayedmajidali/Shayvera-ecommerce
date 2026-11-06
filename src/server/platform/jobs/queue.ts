import { randomUUID } from "node:crypto";
import { Prisma, type Job } from "@prisma/client";
import { db } from "@/server/platform/db";
import { currentContext } from "@/server/platform/context";

/**
 * Durable PostgreSQL job queue (ARCHITECTURE.md D1).
 *
 * - `enqueue` accepts a transaction client, so business writes and the jobs they imply commit or
 *   roll back together (transactional outbox).
 * - Workers claim with `FOR UPDATE SKIP LOCKED`, so any number of worker processes can poll the
 *   same table without double-processing a job.
 * - Failures retry with exponential backoff and full jitter; after `maxAttempts` the job is DEAD
 *   and waits for an operator to retry it from the admin panel.
 * - Handlers must be idempotent: a crash after the side effect but before `completeJob` causes the
 *   job to run again once its lock expires.
 */

/** Job payload types, keyed by job type. Modules add their own entries via declaration merging. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface JobPayloads {}

export type JobType = keyof JobPayloads & string;

type Client = Prisma.TransactionClient | typeof db;

export type EnqueueOptions = {
  /** Run no earlier than this time. */
  runAt?: Date;
  delayMs?: number;
  /** Idempotency key: a second enqueue with the same key is silently ignored. */
  dedupeKey?: string;
  maxAttempts?: number;
  /** Higher runs first among due jobs. */
  priority?: number;
  /** Transaction client to enqueue atomically with other writes. */
  tx?: Prisma.TransactionClient;
};

/** Returns the job id, or null when an identical `dedupeKey` was already enqueued. */
export async function enqueue<T extends JobType>(
  type: T,
  payload: JobPayloads[T],
  opts: EnqueueOptions = {},
): Promise<string | null> {
  const client: Client = opts.tx ?? db;
  const id = randomUUID();
  const runAt = opts.runAt ?? new Date(Date.now() + (opts.delayMs ?? 0));
  const rows = await client.$queryRaw<{ id: string }[]>`
    INSERT INTO "Job" ("id", "type", "payload", "priority", "maxAttempts", "runAt", "dedupeKey", "requestId", "updatedAt")
    VALUES (${id}, ${type}, ${JSON.stringify(payload ?? {})}::jsonb, ${opts.priority ?? 0},
            ${opts.maxAttempts ?? 8}, ${runAt}, ${opts.dedupeKey ?? null}, ${currentContext()?.requestId ?? null}, NOW())
    ON CONFLICT ("dedupeKey") DO NOTHING
    RETURNING "id"`;
  return rows[0]?.id ?? null;
}

export const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

/** Atomically claims up to `limit` due jobs for this worker. */
export async function claimJobs(
  limit = 10,
  workerId = WORKER_ID,
  types?: string[],
): Promise<Job[]> {
  const typeFilter = types?.length
    ? Prisma.sql`AND "type" IN (${Prisma.join(types)})`
    : Prisma.empty;
  return db.$queryRaw<Job[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = NOW(), "lockedBy" = ${workerId},
                     "attempts" = "attempts" + 1, "updatedAt" = NOW()
    WHERE "id" IN (
      SELECT "id" FROM "Job"
      WHERE "status" IN ('QUEUED', 'FAILED') AND "runAt" <= NOW() ${typeFilter}
      ORDER BY "priority" DESC, "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

export async function completeJob(id: string, workerId = WORKER_ID) {
  await db.job.updateMany({
    where: { id, status: "RUNNING", lockedBy: workerId },
    data: {
      status: "SUCCEEDED",
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
}

/** Thrown by handlers for failures that retrying cannot fix (bad payload, missing record). */
export class PermanentJobError extends Error {
  override name = "PermanentJobError";
}

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 6 * 60 * 60 * 1000;

/** Exponential backoff with full jitter: random in [0, min(cap, base·2^(attempt-1))], min 1 s. */
export function backoffMs(attempt: number, random = Math.random) {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  return Math.max(1_000, Math.floor(random() * ceiling));
}

export async function failJob(
  job: Pick<Job, "id" | "attempts" | "maxAttempts">,
  error: unknown,
  workerId = WORKER_ID,
) {
  const message = (
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  ).slice(0, 2000);
  const dead = error instanceof PermanentJobError || job.attempts >= job.maxAttempts;
  await db.job.updateMany({
    where: { id: job.id, status: "RUNNING", lockedBy: workerId },
    data: dead
      ? {
          status: "DEAD",
          lastError: message,
          finishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        }
      : {
          status: "FAILED",
          lastError: message,
          runAt: new Date(Date.now() + backoffMs(job.attempts)),
          lockedAt: null,
          lockedBy: null,
        },
  });
  return dead ? ("dead" as const) : ("retry" as const);
}

/**
 * Returns jobs whose worker died mid-run (lock older than `timeoutMs`) to the queue. Their attempt
 * still counts, so a job that crashes its worker every time eventually goes DEAD.
 */
export async function requeueStuckJobs(timeoutMs = 10 * 60 * 1000) {
  const cutoff = new Date(Date.now() - timeoutMs);
  const stuck = await db.job.updateMany({
    where: {
      status: "RUNNING",
      lockedAt: { lt: cutoff },
      attempts: { lt: db.job.fields.maxAttempts },
    },
    data: { status: "FAILED", lockedAt: null, lockedBy: null, lastError: "Worker lock expired" },
  });
  const dead = await db.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: cutoff } },
    data: {
      status: "DEAD",
      lockedAt: null,
      lockedBy: null,
      finishedAt: new Date(),
      lastError: "Worker lock expired",
    },
  });
  return { requeued: stuck.count, dead: dead.count };
}

/** Operator action: gives a DEAD/FAILED job a fresh set of attempts. */
export async function retryJob(id: string) {
  const res = await db.job.updateMany({
    where: { id, status: { in: ["DEAD", "FAILED"] } },
    data: { status: "QUEUED", attempts: 0, runAt: new Date(), lastError: null, finishedAt: null },
  });
  return res.count === 1;
}

/** Deletes finished jobs older than the retention window. DEAD jobs are kept for inspection. */
export async function pruneJobs(olderThanDays = 14) {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const res = await db.job.deleteMany({
    where: { status: "SUCCEEDED", finishedAt: { lt: cutoff } },
  });
  return res.count;
}

export async function queueStats() {
  const [byStatus, oldest] = await Promise.all([
    db.job.groupBy({ by: ["status"], _count: { _all: true } }),
    db.job.findFirst({
      where: { status: { in: ["QUEUED", "FAILED"] }, runAt: { lte: new Date() } },
      orderBy: { runAt: "asc" },
      select: { runAt: true },
    }),
  ]);
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) as Record<
    string,
    number
  >;
  return {
    queued: (counts.QUEUED ?? 0) + (counts.FAILED ?? 0),
    running: counts.RUNNING ?? 0,
    dead: counts.DEAD ?? 0,
    oldestDueAgeMs: oldest ? Date.now() - oldest.runAt.getTime() : 0,
  };
}
