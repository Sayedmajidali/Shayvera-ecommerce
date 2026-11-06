import { db } from "@/server/platform/db";
import { enqueue, type JobPayloads, type JobType } from "./queue";

export type Schedule = {
  [T in JobType]: { type: T; everyMs: number; payload: JobPayloads[T] };
}[JobType];

/**
 * Enqueues each periodic job once per interval. The dedupe key is derived from the interval
 * window, so several workers ticking at once still produce exactly one job per window.
 */
export async function enqueueScheduled(schedules: Schedule[], now = Date.now()) {
  let created = 0;
  for (const s of schedules) {
    const window = Math.floor(now / s.everyMs);
    const id = await enqueue(s.type, s.payload, { dedupeKey: `schedule:${s.type}:${window}` });
    if (id) created++;
  }
  return created;
}

export const HEARTBEAT_KEY = "worker:heartbeat";

export async function writeHeartbeat(workerId: string) {
  const value = { workerId, at: new Date().toISOString() };
  await db.systemState.upsert({
    where: { key: HEARTBEAT_KEY },
    create: { key: HEARTBEAT_KEY, value },
    update: { value },
  });
}

export async function readHeartbeat(): Promise<{ workerId: string; at: Date } | null> {
  const row = await db.systemState.findUnique({ where: { key: HEARTBEAT_KEY } });
  const v = row?.value as { workerId?: string; at?: string } | undefined;
  if (!v?.at || !v.workerId) return null;
  return { workerId: v.workerId, at: new Date(v.at) };
}
