import "server-only";
import { z } from "zod";
import type { JobStatus, Prisma } from "@prisma/client";
import { db } from "@/server/platform/db";
import { queueStats } from "@/server/platform/jobs/queue";
import { readHeartbeat } from "@/server/platform/jobs/scheduler";
import { env, shippingProviderName } from "@/lib/env";
import { emailProvider } from "@/server/modules/notifications/email-service";

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

export type StatusLevel = "ok" | "warn" | "off";
export type StatusRow = { name: string; level: StatusLevel; value: string; detail?: string };

/**
 * Configuration and liveness of each integration, for Admin → Background jobs. Shows modes and
 * timestamps only — never a key, secret or token value.
 */
export async function getSystemStatus(): Promise<StatusRow[]> {
  const e = env();
  const prod = e.NODE_ENV === "production";
  const t0 = performance.now();
  await db.$queryRaw`SELECT 1`;
  const dbMs = Math.round(performance.now() - t0);
  const [lastPaymentEvent, lastCourierEvent, pickup, settings] = await Promise.all([
    db.paymentEvent.findFirst({
      where: { source: "webhook" },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
    db.webhookEvent.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    db.pickupLocation.findFirst({ where: { isDefault: true }, select: { name: true } }),
    db.storeSettings.findUnique({ where: { id: "default" }, select: { alertEmails: true } }),
  ]);
  const ago = (d: Date | null | undefined) => {
    if (!d) return "never";
    const m = Math.round((Date.now() - d.getTime()) / 60_000);
    return m < 60
      ? `${m} min ago`
      : m < 2880
        ? `${Math.round(m / 60)} h ago`
        : `${Math.round(m / 1440)} days ago`;
  };
  const payMode =
    e.PAYMENT_GATEWAY === "mock"
      ? "Simulator (testing only)"
      : e.RAZORPAY_KEY_ID.startsWith("rzp_live_")
        ? "Razorpay live"
        : e.RAZORPAY_KEY_ID.startsWith("rzp_test_")
          ? "Razorpay test mode"
          : "Razorpay (keys missing)";
  const ship = shippingProviderName();
  return [
    { name: "Database", level: dbMs < 200 ? "ok" : "warn", value: `Reachable · ${dbMs} ms` },
    {
      name: "Payments",
      level:
        e.PAYMENT_GATEWAY === "razorpay" && !e.RAZORPAY_KEY_ID
          ? "warn"
          : prod && e.PAYMENT_GATEWAY === "mock"
            ? "warn"
            : "ok",
      value: payMode,
      detail: `Webhook secret ${e.RAZORPAY_WEBHOOK_SECRET ? "set" : "missing"}${e.RAZORPAY_WEBHOOK_SECRET_PREVIOUS ? " (rotation in progress)" : ""} · last webhook ${ago(lastPaymentEvent?.receivedAt)}`,
    },
    {
      name: "Shipping",
      level:
        ship === "shiprocket" && (!e.SHIPROCKET_WEBHOOK_TOKEN || !pickup)
          ? "warn"
          : ship === "manual"
            ? "off"
            : "ok",
      value:
        ship === "shiprocket"
          ? "Shiprocket"
          : ship === "mock"
            ? "Courier simulator (testing only)"
            : "Manual (staff enter courier and AWB)",
      detail:
        ship === "manual"
          ? undefined
          : `Webhook token ${e.SHIPROCKET_WEBHOOK_TOKEN ? "set" : "missing"} · pickup location ${pickup ? `“${pickup.name}”` : "not set"} · last courier update ${ago(lastCourierEvent?.receivedAt)}`,
    },
    {
      name: "Email",
      level: prod && emailProvider().name === "dev-outbox" ? "warn" : "ok",
      value:
        emailProvider().name === "dev-outbox"
          ? "Development outbox (not delivered)"
          : emailProvider().name,
      detail: "Messages are listed in Admin → Messages & emails",
    },
    {
      name: "Error reporting",
      level: e.MONITORING_WEBHOOK_URL ? "ok" : "off",
      value: e.MONITORING_WEBHOOK_URL
        ? `Webhook → ${new URL(e.MONITORING_WEBHOOK_URL).host}`
        : "Logs only",
      detail: `Slow API requests (≥ ${e.SLOW_REQUEST_MS} ms) are logged`,
    },
    {
      name: "Staff alerts",
      level: settings?.alertEmails.length ? "ok" : "off",
      value: settings?.alertEmails.length ? `${settings.alertEmails.length} address(es)` : "Off",
      detail: "Admin → Settings → Numbering & alerts",
    },
  ];
}
