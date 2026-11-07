import { registerJob } from "@/server/platform/jobs/runner";
import { pruneJobs, requeueStuckJobs } from "@/server/platform/jobs/queue";
import type { Schedule } from "@/server/platform/jobs/scheduler";
import { logger } from "@/server/platform/logger";
import { db } from "@/server/platform/db";
import { deliverNotification } from "@/server/modules/notifications/notifications";
import {
  expireStalePendingOrders,
  processWebhookEvent,
  reconcilePayments,
  reconcileRefund,
  runCaptureFollowUp,
} from "@/server/modules/payments/payments";
import { findInventoryDrift } from "@/server/modules/inventory/inventory";
import {
  cancelShipment,
  processCourierWebhook,
  processShipmentCreation,
  syncTracking,
} from "@/server/modules/shipping/shipments";

/**
 * Composition root for background work: every job type and periodic schedule is listed here, so
 * the worker, the in-process runner and the tests all register the same handlers.
 */
declare module "@/server/platform/jobs/queue" {
  interface JobPayloads {
    "payments.expire-unpaid": Record<string, never>;
    "maintenance.cleanup": Record<string, never>;
    "inventory.reconcile": Record<string, never>;
  }
}

let registered = false;

export function registerAllJobs() {
  if (registered) return;
  registered = true;

  registerJob("notification.send", (p, ctx) => deliverNotification(p.notificationId, ctx));

  registerJob("shipping.create", (p, ctx) => processShipmentCreation(p.shipmentId, ctx));
  registerJob("shipping.cancel", (p) => cancelShipment(p.shipmentId, p.reason, null));
  registerJob("shipping.webhook", (p) => processCourierWebhook(p.webhookEventId));
  registerJob("shipping.sync-tracking", async () => {
    const r = await syncTracking();
    if (r.checked) logger.info("Tracking sync", r);
  });

  registerJob("payments.webhook", (p, ctx) => processWebhookEvent(p.eventId, ctx));
  registerJob("payments.capture-followup", (p) => runCaptureFollowUp(p));
  registerJob("payments.reconcile-refund", async (p) => {
    await reconcileRefund(p.refundId);
  });
  registerJob("payments.reconcile", async () => {
    const r = await reconcilePayments();
    if (r.attemptsChecked || r.refundsChecked) logger.info("Payment reconciliation", r);
  });

  registerJob("payments.expire-unpaid", async () => {
    const r = await expireStalePendingOrders(200);
    if (r.checked) logger.info("Expired unpaid orders", r);
  });

  // Report-only: drift between Inventory.quantityReserved and ACTIVE reservations, and holds whose
  // payment window lapsed long ago (the expiry job should have released them). Never edits stock.
  registerJob("inventory.reconcile", async () => {
    const drift = await findInventoryDrift();
    const staleHolds = await db.inventoryReservation.count({
      where: { status: "ACTIVE", expiresAt: { lt: new Date(Date.now() - 30 * 60_000) } },
    });
    const value = {
      at: new Date().toISOString(),
      driftCount: drift.length,
      staleHolds,
      sample: drift.slice(0, 20),
    };
    await db.systemState.upsert({
      where: { key: "inventory:reconciliation" },
      create: { key: "inventory:reconciliation", value },
      update: { value },
    });
    if (drift.length > 0 || staleHolds > 0)
      logger.warn("Inventory reconciliation found discrepancies", {
        driftCount: drift.length,
        staleHolds,
      });
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
  { type: "payments.reconcile", everyMs: 15 * 60_000, payload: {} },
  { type: "shipping.sync-tracking", everyMs: 30 * 60_000, payload: {} },
  { type: "maintenance.cleanup", everyMs: 60 * 60_000, payload: {} },
  { type: "inventory.reconcile", everyMs: 60 * 60_000, payload: {} },
];
