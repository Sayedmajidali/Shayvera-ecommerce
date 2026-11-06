import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import {
  claimJobs,
  enqueue,
  PermanentJobError,
  requeueStuckJobs,
  retryJob,
} from "@/server/platform/jobs/queue";
import { registerJob, runDueJobs } from "@/server/platform/jobs/runner";
import { enqueueScheduled, readHeartbeat, writeHeartbeat } from "@/server/platform/jobs/scheduler";
import * as healthRoute from "@/app/api/health/route";
import { drainJobs } from "../helpers/db";
import { cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { makeProduct } from "../helpers/fixtures";

declare module "@/server/platform/jobs/queue" {
  interface JobPayloads {
    "test.ok": { n: number };
    "test.flaky": { key: string };
    "test.always-fails": Record<string, never>;
    "test.permanent": Record<string, never>;
  }
}

const seen: number[] = [];
const flakyCalls = new Map<string, number>();
registerJob("test.ok", async (p) => {
  seen.push(p.n);
});
registerJob("test.flaky", async (p) => {
  const n = (flakyCalls.get(p.key) ?? 0) + 1;
  flakyCalls.set(p.key, n);
  if (n === 1) throw new Error("transient provider outage");
});
registerJob("test.always-fails", async () => {
  throw new Error("still broken");
});
registerJob("test.permanent", async () => {
  throw new PermanentJobError("bad payload");
});

const makeDue = (id: string) =>
  db.job.update({ where: { id }, data: { runAt: new Date(Date.now() - 1000) } });

describe("job queue", () => {
  it("runs jobs and ignores duplicate dedupe keys", async () => {
    seen.length = 0;
    const a = await enqueue("test.ok", { n: 1 }, { dedupeKey: "same" });
    const b = await enqueue("test.ok", { n: 2 }, { dedupeKey: "same" });
    expect(a).toBeTruthy();
    expect(b).toBeNull();
    expect(await runDueJobs()).toBe(1);
    expect(seen).toEqual([1]);
    expect((await db.job.findUniqueOrThrow({ where: { id: a! } })).status).toBe("SUCCEEDED");
  });

  it("enqueues atomically with the surrounding transaction", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await enqueue("test.ok", { n: 9 }, { tx });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await db.job.count()).toBe(0);
  });

  it("does not run jobs before runAt", async () => {
    await enqueue("test.ok", { n: 3 }, { delayMs: 60_000 });
    expect(await runDueJobs()).toBe(0);
  });

  it("never hands the same job to two concurrent workers", async () => {
    for (let i = 0; i < 40; i++) await enqueue("test.ok", { n: i });
    const batches = await Promise.all(
      ["w1", "w2", "w3", "w4"].map((w) => claimJobs(15, w, ["test.ok"])),
    );
    const ids = batches.flat().map((j) => j.id);
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
  });

  it("retries a failed job with backoff, then succeeds", async () => {
    const id = (await enqueue("test.flaky", { key: "k1" }))!;
    await runDueJobs();
    let job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("FAILED");
    expect(job.attempts).toBe(1);
    expect(job.lastError).toContain("transient provider outage");
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(await runDueJobs()).toBe(0); // backoff not yet elapsed

    await makeDue(id);
    await runDueJobs();
    job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("SUCCEEDED");
    expect(job.attempts).toBe(2);
  });

  it("dead-letters after maxAttempts and can be retried by an operator", async () => {
    const id = (await enqueue("test.always-fails", {}, { maxAttempts: 2 }))!;
    await runDueJobs();
    await makeDue(id);
    await runDueJobs();
    let job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("DEAD");
    expect(job.attempts).toBe(2);

    expect(await retryJob(id)).toBe(true);
    job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job).toMatchObject({ status: "QUEUED", attempts: 0, lastError: null });
  });

  it("dead-letters permanent errors immediately", async () => {
    const id = (await enqueue("test.permanent", {}))!;
    await runDueJobs();
    const job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("DEAD");
    expect(job.attempts).toBe(1);
  });

  it("returns jobs abandoned by a crashed worker to the queue", async () => {
    const id = (await enqueue("test.ok", { n: 7 }))!;
    await claimJobs(1, "crashed-worker");
    await db.job.update({ where: { id }, data: { lockedAt: new Date(Date.now() - 60 * 60_000) } });
    expect(await requeueStuckJobs(10 * 60_000)).toEqual({ requeued: 1, dead: 0 });
    expect(await runDueJobs()).toBe(1);
    expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe("SUCCEEDED");
  });

  it("a stale worker cannot complete a job another worker re-claimed", async () => {
    const id = (await enqueue("test.ok", { n: 8 }))!;
    await claimJobs(1, "slow-worker");
    await db.job.update({
      where: { id },
      data: { status: "QUEUED", lockedBy: null, lockedAt: null },
    });
    await claimJobs(1, "fresh-worker");
    const { completeJob } = await import("@/server/platform/jobs/queue");
    await completeJob(id, "slow-worker");
    expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe("RUNNING");
  });

  it("enqueues each periodic job once per window across workers", async () => {
    const schedules = [{ type: "test.ok" as const, everyMs: 60_000, payload: { n: 1 } }];
    const now = Date.now();
    const created = await Promise.all([
      enqueueScheduled(schedules, now),
      enqueueScheduled(schedules, now),
    ]);
    expect(created[0]! + created[1]!).toBe(1);
    expect(await enqueueScheduled(schedules, now + 60_000)).toBe(1);
  });

  it("records and reads the worker heartbeat", async () => {
    await writeHeartbeat("worker:test");
    const hb = await readHeartbeat();
    expect(hb?.workerId).toBe("worker:test");
    expect(Date.now() - hb!.at.getTime()).toBeLessThan(5000);
  });
});

describe("notifications", () => {
  it("queues order emails in the order transaction and logs delivery", async () => {
    const p = await makeProduct({ price: 50_000, stock: 5 });
    const cookie = await cartWith(p.variants[0]!.id, 1);
    const { res, json } = await checkout(cookie, checkoutBody());
    expect(res.status).toBe(201);

    const order = await db.order.findUniqueOrThrow({
      where: { orderNumber: json.data.orderNumber },
    });
    const n = await db.notification.findFirstOrThrow({ where: { orderId: order.id } });
    expect(n).toMatchObject({ template: "order-confirmed", status: "QUEUED", channel: "EMAIL" });
    expect(await db.outboundEmail.count()).toBe(0);

    await drainJobs();
    const sent = await db.notification.findUniqueOrThrow({
      where: { id: n.id },
      include: { logs: true },
    });
    expect(sent.status).toBe("SENT");
    expect(sent.logs).toHaveLength(1);
    expect(sent.logs[0]).toMatchObject({ success: true, provider: "dev-outbox", attempt: 1 });
    expect(await db.outboundEmail.count({ where: { template: "order-confirmed" } })).toBe(1);

    // Running the queue again sends nothing more.
    await drainJobs();
    expect(await db.outboundEmail.count()).toBe(1);
  });

  it("deduplicates the same order event (same dedupe key)", async () => {
    const p = await makeProduct({ price: 50_000, stock: 5 });
    const cookie = await cartWith(p.variants[0]!.id, 1);
    const { json } = await checkout(cookie, checkoutBody());
    const order = await db.order.findUniqueOrThrow({
      where: { orderNumber: json.data.orderNumber },
    });
    const { queueOrderEmail } = await import("@/server/modules/notifications/notifications");
    const first = await db.$transaction((tx) =>
      queueOrderEmail(tx, { orderId: order.id, kind: "refunded", dedupeKey: "refund-1" }),
    );
    const again = await db.$transaction((tx) =>
      queueOrderEmail(tx, { orderId: order.id, kind: "refunded", dedupeKey: "refund-1" }),
    );
    expect(first).toBeTruthy();
    expect(again).toBeNull();
    expect(
      await db.notification.count({ where: { orderId: order.id, template: "order-refunded" } }),
    ).toBe(1);
  });

  it("marks a notification FAILED with a logged attempt when it cannot be rendered", async () => {
    const n = await db.notification.create({
      data: {
        template: "order-confirmed",
        recipient: "x@example.com",
        payload: { orderId: "missing-order", kind: "confirmed" },
      },
    });
    await enqueue("notification.send", { notificationId: n.id });
    await drainJobs();
    const failed = await db.notification.findUniqueOrThrow({
      where: { id: n.id },
      include: { logs: true },
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.logs[0]).toMatchObject({ success: false });
    expect((await db.job.findFirstOrThrow({ where: { type: "notification.send" } })).status).toBe(
      "DEAD",
    );
  });
});

describe("health", () => {
  it("reports database and queue state without configuration details", async () => {
    await enqueue("test.permanent", {});
    await runDueJobs();
    const res = await healthRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      database: "up",
      jobs: { runner: "off", worker: "disabled", dead: 1 },
    });
    expect(JSON.stringify(body)).not.toMatch(/postgres|secret|password/i);
  });
});
