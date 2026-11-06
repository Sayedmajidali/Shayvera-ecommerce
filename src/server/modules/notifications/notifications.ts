import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/platform/db";
import { enqueue, PermanentJobError } from "@/server/platform/jobs/queue";
import type { JobContext } from "@/server/platform/jobs/runner";
import { logger } from "@/server/platform/logger";
import { deliverEmail, emailProvider } from "@/server/modules/notifications/email-service";
import {
  ORDER_EMAIL_KINDS,
  renderOrderEmail,
  type OrderEmailKind,
} from "@/server/modules/notifications/order-emails";

declare module "@/server/platform/jobs/queue" {
  interface JobPayloads {
    "notification.send": { notificationId: string };
  }
}

type OrderEmailPayload = { orderId: string; kind: OrderEmailKind; extra?: string | null };

/**
 * Records an order notification and enqueues its delivery inside the caller's transaction, so the
 * email exists if and only if the business change committed. `dedupeKey` prevents duplicates when
 * the same event is processed twice (e.g. webhook + reconciliation).
 */
export async function queueOrderEmail(
  tx: Tx,
  p: { orderId: string; kind: OrderEmailKind; extra?: string | null; dedupeKey?: string },
) {
  const order = await tx.order.findUnique({ where: { id: p.orderId }, select: { email: true } });
  if (!order) return null;
  const dedupeKey = `notify:order:${p.orderId}:${p.kind}${p.dedupeKey ? `:${p.dedupeKey}` : ""}`;
  const notification = await tx.notification.create({
    data: {
      channel: "EMAIL",
      template: `order-${p.kind}`,
      recipient: order.email,
      orderId: p.orderId,
      payload: {
        orderId: p.orderId,
        kind: p.kind,
        extra: p.extra ?? null,
      } satisfies OrderEmailPayload,
    },
  });
  const jobId = await enqueue(
    "notification.send",
    { notificationId: notification.id },
    { tx, dedupeKey },
  );
  if (!jobId) {
    // Already queued for this event; drop the duplicate record.
    await tx.notification.delete({ where: { id: notification.id } });
    return null;
  }
  return notification.id;
}

function isOrderEmailPayload(v: Prisma.JsonValue): v is OrderEmailPayload {
  const o = v as Record<string, unknown> | null;
  return (
    !!o &&
    typeof o.orderId === "string" &&
    (ORDER_EMAIL_KINDS as readonly string[]).includes(o.kind as string)
  );
}

/** Job handler: renders and delivers one notification, logging every attempt. */
export async function deliverNotification(notificationId: string, ctx: JobContext) {
  const n = await db.notification.findUnique({ where: { id: notificationId } });
  if (!n) throw new PermanentJobError("Notification not found");
  if (n.status === "SENT") return; // idempotent re-run

  if (n.channel !== "EMAIL") throw new PermanentJobError(`Channel ${n.channel} is not configured`);
  if (!n.template.startsWith("order-") || !isOrderEmailPayload(n.payload))
    throw new PermanentJobError(`Unknown notification template ${n.template}`);

  const attempt = n.attempts + 1;
  try {
    const message = await renderOrderEmail(n.payload.orderId, n.payload.kind, n.payload.extra);
    if (!message) throw new PermanentJobError("Order no longer exists");
    const result = await deliverEmail(message);
    await db.$transaction([
      db.notification.update({
        where: { id: n.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          attempts: attempt,
          lastError: null,
          subject: message.subject,
        },
      }),
      db.notificationLog.create({
        data: {
          notificationId: n.id,
          attempt,
          provider: result.provider,
          success: true,
          providerMessageId: result.messageId,
        },
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const final = ctx.isLastAttempt || error instanceof PermanentJobError;
    await db.$transaction([
      db.notification.update({
        where: { id: n.id },
        data: {
          attempts: attempt,
          lastError: message.slice(0, 1000),
          status: final ? "FAILED" : "QUEUED",
        },
      }),
      db.notificationLog.create({
        data: {
          notificationId: n.id,
          attempt,
          provider: emailProvider().name,
          success: false,
          error: message.slice(0, 1000),
        },
      }),
    ]);
    logger.warn("Notification delivery failed", { notificationId: n.id, attempt, final });
    throw error;
  }
}

/** Operator action: re-send a FAILED notification. */
export async function retryNotification(notificationId: string) {
  const n = await db.notification.findUnique({ where: { id: notificationId } });
  if (!n || n.status !== "FAILED") return false;
  await db.notification.update({ where: { id: n.id }, data: { status: "QUEUED" } });
  await enqueue(
    "notification.send",
    { notificationId: n.id },
    { dedupeKey: `notify:retry:${n.id}:${n.attempts}` },
  );
  return true;
}
