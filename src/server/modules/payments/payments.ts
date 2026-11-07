import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type OrderStatus } from "@prisma/client";
import { db, type Tx } from "@/server/platform/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/server/platform/logger";
import { queueOrderEmail } from "@/server/modules/notifications/notifications";
import { issueCreditNoteForRefund } from "@/server/modules/invoices/credit-notes";
import { queueStaffAlert } from "@/server/modules/notifications/staff-alerts";
import { formatINRExact } from "@/lib/money";
import {
  GatewayError,
  paymentGateway,
  type GatewayPayment,
} from "@/server/modules/payments/gateway";
import { enqueue, retryJob } from "@/server/platform/jobs/queue";
import type { JobContext } from "@/server/platform/jobs/runner";

declare module "@/server/platform/jobs/queue" {
  interface JobPayloads {
    "payments.webhook": { eventId: string };
    "payments.capture-followup": {
      orderId: string;
      razorpayPaymentId: string;
      needsReinstate: boolean;
    };
    "payments.reconcile-refund": { refundId: string };
    "payments.reconcile": Record<string, never>;
  }
}
import {
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "@/server/modules/payments/signature";
import { reserveStock } from "@/server/modules/inventory/inventory";
import { transitionOrder, type Actor } from "@/server/modules/orders/orders";
import { AWAITING_PAYMENT } from "@/server/modules/orders/order-status";

/** Order statuses in which a full refund moves the order to REFUND_PENDING / REFUNDED. */
const REFUND_STARTABLE: OrderStatus[] = ["CANCELLED", "RETURNED", "DELIVERED"];
const REFUND_COMPLETABLE: OrderStatus[] = [...REFUND_STARTABLE, "REFUND_PENDING"];

const SYSTEM: Actor = { type: "SYSTEM" };
const DUPLICATE_PREFIX = "[duplicate payment] ";

// ───────────────────────────── Start payment ─────────────────────────────

export type OnlinePaymentSession = {
  keyId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: "INR";
  orderNumber: string;
  gateway: "razorpay" | "mock";
  prefill: { name: string; email: string; contact: string };
};

/**
 * Creates (or reuses) a gateway order for a pending online-payment order.
 * Safe to call repeatedly (retry after failure / interrupted checkout).
 */
export async function startOnlinePayment(orderId: string): Promise<OnlinePaymentSession> {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { payments: true } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found");
  if (order.paymentMethod !== "RAZORPAY")
    throw new AppError("INVALID_STATE", "This order is not an online-payment order");
  if (order.paymentStatus === "PAID")
    throw new AppError("INVALID_STATE", "This order is already paid");
  if (!AWAITING_PAYMENT.includes(order.status))
    throw new AppError("INVALID_STATE", "This order can no longer be paid");
  if (order.paymentExpiresAt && order.paymentExpiresAt < new Date()) {
    throw new AppError("INVALID_STATE", "The payment window for this order has expired");
  }

  const gateway = paymentGateway();
  const reusable = order.payments.find(
    (p) =>
      p.method === "RAZORPAY" &&
      p.status === "CREATED" &&
      p.razorpayOrderId &&
      p.amountPaise === order.totalPaise,
  );
  let razorpayOrderId = reusable?.razorpayOrderId ?? null;
  if (!razorpayOrderId) {
    const gwOrder = await gateway.createOrder({
      amountPaise: order.totalPaise,
      receipt: order.orderNumber,
      notes: { orderId: order.id, orderNumber: order.orderNumber },
    });
    if (gwOrder.amount !== order.totalPaise)
      throw new AppError("PAYMENT_ERROR", "Payment amount mismatch");
    await db.payment.create({
      data: {
        orderId: order.id,
        method: "RAZORPAY",
        status: "CREATED",
        amountPaise: order.totalPaise,
        razorpayOrderId: gwOrder.id,
      },
    });
    razorpayOrderId = gwOrder.id;
  }
  if (order.paymentStatus === "FAILED") {
    await db.order.update({ where: { id: order.id }, data: { paymentStatus: "PENDING" } });
  }
  const addr = order.shippingAddress as { fullName?: string };
  return {
    keyId: gateway.keyId,
    razorpayOrderId,
    amountPaise: order.totalPaise,
    currency: "INR",
    orderNumber: order.orderNumber,
    gateway: gateway.name,
    prefill: { name: addr.fullName ?? "", email: order.email, contact: order.phone },
  };
}

// ──────────────────────── Recording events (idempotency) ────────────────────────

/** Stores an event once. Returns false when this event id was already processed. */
async function recordEvent(p: {
  eventId: string;
  eventType: string;
  source: "webhook" | "checkout" | "reconcile";
  signatureValid: boolean;
  payload: unknown;
  razorpayOrderId?: string | null;
}): Promise<{ id: string; fresh: boolean }> {
  const payment = p.razorpayOrderId
    ? await db.payment.findUnique({ where: { razorpayOrderId: p.razorpayOrderId } })
    : null;
  // Fast path for retries/duplicates (avoids relying on the unique-violation error path).
  const seen = await db.paymentEvent.findUnique({ where: { eventId: p.eventId } });
  if (seen) return { id: seen.id, fresh: seen.processedAt === null };
  try {
    const ev = await db.paymentEvent.create({
      data: {
        eventId: p.eventId,
        eventType: p.eventType,
        source: p.source,
        signatureValid: p.signatureValid,
        payload: p.payload as Prisma.InputJsonValue,
        paymentId: payment?.id ?? null,
        orderId: payment?.orderId ?? null,
      },
    });
    return { id: ev.id, fresh: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.paymentEvent.findUniqueOrThrow({ where: { eventId: p.eventId } });
      // An event that previously failed mid-processing may be retried.
      return { id: existing.id, fresh: existing.processedAt === null };
    }
    throw error;
  }
}

async function finishEvent(id: string, error?: unknown) {
  await db.paymentEvent.update({
    where: { id },
    data: error
      ? { processingError: error instanceof Error ? error.message.slice(0, 500) : "Unknown error" }
      : { processedAt: new Date(), processingError: null },
  });
}

// ───────────────────────────── Capture / failure ─────────────────────────────

/** Row-locks the payment so the checkout callback and webhooks are applied one at a time. */
async function lockPayment(tx: Tx, razorpayOrderId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Payment" WHERE "razorpayOrderId" = ${razorpayOrderId} FOR UPDATE`;
  if (!rows[0]) return null;
  return tx.payment.findUniqueOrThrow({ where: { id: rows[0].id }, include: { order: true } });
}

export type CaptureOutcome =
  | "confirmed"
  | "already_captured"
  | "reinstated"
  | "refund_required"
  | "amount_mismatch"
  | "unknown_order";

/**
 * Applies verified evidence that a payment was captured. Idempotent and safe against
 * out-of-order delivery (late capture after expiry, duplicate webhooks, callback + webhook races).
 */
export async function applyCapturedPayment(
  gp: GatewayPayment,
  source: string,
): Promise<CaptureOutcome> {
  type Result = { outcome: CaptureOutcome; orderId?: string; needsReinstate?: boolean };
  const result: Result = await db.$transaction(async (tx) => {
    const r = await decideCapture(tx);
    // Follow-ups that call the gateway (reinstate or refund) run as a job, enqueued atomically.
    if (r.outcome === "refund_required" && r.orderId)
      await enqueue(
        "payments.capture-followup",
        { orderId: r.orderId, razorpayPaymentId: gp.id, needsReinstate: Boolean(r.needsReinstate) },
        { tx, dedupeKey: `capture-followup:${gp.id}` },
      );
    return r;
  });
  return result.outcome;

  async function decideCapture(tx: Tx): Promise<Result> {
    const payment = await lockPayment(tx, gp.orderId);
    if (!payment) return { outcome: "unknown_order" };
    const order = payment.order;

    if (payment.status === "CAPTURED" && payment.razorpayPaymentId === gp.id)
      return { outcome: "already_captured", orderId: order.id };

    if (gp.amount !== payment.amountPaise || gp.currency !== "INR") {
      await tx.order.update({
        where: { id: order.id },
        data: {
          requiresAttention: true,
          attentionReason: `Captured amount ${gp.amount} differs from expected ${payment.amountPaise}`,
        },
      });
      logger.error("Payment amount mismatch", {
        orderNumber: order.orderNumber,
        expected: payment.amountPaise,
        got: gp.amount,
      });
      return { outcome: "amount_mismatch", orderId: order.id };
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "CAPTURED",
        razorpayPaymentId: gp.id,
        capturedAt: new Date(),
        instrument: gp.method,
        errorCode: null,
        errorDescription: null,
      },
    });

    // A different payment already paid this order (customer paid twice) → refund this one.
    if (order.paymentStatus === "PAID") {
      await tx.order.update({
        where: { id: order.id },
        data: { requiresAttention: true, attentionReason: `Duplicate payment ${gp.id} captured` },
      });
      return { outcome: "refund_required", orderId: order.id };
    }

    if (AWAITING_PAYMENT.includes(order.status)) {
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: "PAID", paymentExpiresAt: null },
      });
      await transitionOrder(tx, {
        orderId: order.id,
        to: "CONFIRMED",
        actor: SYSTEM,
        note: `Payment captured (${source})`,
      });
      return { outcome: "confirmed", orderId: order.id };
    }

    if (order.status === "CANCELLED") {
      await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });
      return { outcome: "refund_required", orderId: order.id, needsReinstate: true };
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        requiresAttention: true,
        attentionReason: `Unexpected capture in status ${order.status}`,
      },
    });
    return { outcome: "refund_required", orderId: order.id };
  }
}

/**
 * Job: a capture arrived for an order that cannot simply be confirmed. Expired orders are reinstated
 * when stock allows; otherwise (or for duplicate payments) the payment is refunded in full.
 */
export async function runCaptureFollowUp(p: {
  orderId: string;
  razorpayPaymentId: string;
  needsReinstate: boolean;
}) {
  if (p.needsReinstate && (await tryReinstateCancelledOrder(p.orderId, p.razorpayPaymentId)))
    return;
  await refundCapturedPayment(
    p.orderId,
    p.razorpayPaymentId,
    "Payment received for an order that could not be fulfilled",
  );
}

/**
 * Late capture for an order that expired: if every item can be re-reserved, reinstate it as CONFIRMED.
 * This deliberately bypasses the normal state machine (CANCELLED→CONFIRMED) and is fully audited.
 */
async function tryReinstateCancelledOrder(orderId: string, paymentId: string): Promise<boolean> {
  try {
    await db.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      });
      if (order.status !== "CANCELLED")
        throw new AppError("INVALID_STATE", "Order is not cancelled");
      for (const item of order.items) {
        if (!item.variantId) throw new AppError("OUT_OF_STOCK", "Variant no longer exists");
        // Paid now, so the new hold does not expire.
        await reserveStock(tx, { orderId, variantId: item.variantId, quantity: item.quantity });
      }
      const res = await tx.order.updateMany({
        where: { id: orderId, status: "CANCELLED" },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          cancelledAt: null,
          cancelReason: null,
        },
      });
      if (res.count === 0) throw new AppError("CONFLICT", "Order changed concurrently");
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: "CANCELLED",
          toStatus: "CONFIRMED",
          actorType: "SYSTEM",
          note: `Reinstated after late payment capture (${paymentId})`,
        },
      });
      for (const item of order.items) {
        if (item.productId)
          await tx.product.update({
            where: { id: item.productId },
            data: { salesCount: { increment: item.quantity } },
          });
      }
      await queueOrderEmail(tx, { orderId, kind: "confirmed", dedupeKey: "reinstated" });
    });
    logger.warn("Order reinstated after late payment", { orderId });
    return true;
  } catch (error) {
    logger.warn("Could not reinstate order after late payment; refunding", { orderId, error });
    return false;
  }
}

export async function applyFailedPayment(gp: GatewayPayment) {
  await db.$transaction(async (tx) => {
    const payment = await lockPayment(tx, gp.orderId);
    if (!payment) return;
    // Never downgrade a captured payment (out-of-order "failed" event for an earlier attempt).
    if (payment.status === "CAPTURED" || payment.status === "REFUNDED") return;
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        razorpayPaymentId: payment.razorpayPaymentId ?? gp.id,
        errorCode: gp.errorCode,
        errorDescription: gp.errorDescription?.slice(0, 300) ?? null,
        instrument: gp.method,
      },
    });
    if (AWAITING_PAYMENT.includes(payment.order.status) && payment.order.paymentStatus !== "PAID") {
      await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: "FAILED" } });
      // The order stays payable (stock held) until the payment window lapses.
      if (payment.order.status === "PENDING")
        await transitionOrder(tx, {
          orderId: payment.orderId,
          to: "PAYMENT_FAILED",
          actor: SYSTEM,
          note: gp.errorDescription?.slice(0, 200) ?? "Payment attempt failed",
        });
    }
  });
}

// ───────────────────────────── Checkout callback ─────────────────────────────

export type CheckoutCallback = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

/**
 * Handles the Checkout.js success handler. The signature proves the ids came from Razorpay;
 * the payment status and amount are then confirmed with a server-to-server fetch.
 */
export async function verifyCheckoutCallback(cb: CheckoutCallback) {
  const secret = process.env.RAZORPAY_KEY_SECRET ?? "";
  const valid = verifyCheckoutSignature({
    orderId: cb.razorpay_order_id,
    paymentId: cb.razorpay_payment_id,
    signature: cb.razorpay_signature,
    secret: process.env.PAYMENT_GATEWAY === "mock" ? secret || "mock_secret" : secret,
  });
  const payment = await db.payment.findUnique({
    where: { razorpayOrderId: cb.razorpay_order_id },
    include: { order: true },
  });
  if (!payment) throw new AppError("NOT_FOUND", "Payment not found");
  const ev = await recordEvent({
    eventId: `checkout:${cb.razorpay_payment_id}`,
    eventType: "checkout.callback",
    source: "checkout",
    signatureValid: valid,
    payload: {
      razorpay_order_id: cb.razorpay_order_id,
      razorpay_payment_id: cb.razorpay_payment_id,
    },
    razorpayOrderId: cb.razorpay_order_id,
  });
  if (!valid) {
    await finishEvent(ev.id, new Error("Invalid signature"));
    logger.warn("Invalid checkout signature", { orderNumber: payment.order.orderNumber });
    throw new AppError("VALIDATION_ERROR", "Payment verification failed");
  }

  const gp = await paymentGateway().fetchPayment(cb.razorpay_payment_id);
  if (gp.orderId !== cb.razorpay_order_id) {
    await finishEvent(ev.id, new Error("Payment/order mismatch"));
    throw new AppError("VALIDATION_ERROR", "Payment verification failed");
  }
  try {
    let outcome: string;
    if (gp.status === "captured") outcome = await applyCapturedPayment(gp, "checkout");
    else if (gp.status === "failed") {
      await applyFailedPayment(gp);
      outcome = "failed";
    } else outcome = "pending"; // authorized: capture confirmation will arrive via webhook
    await finishEvent(ev.id);
    const order = await db.order.findUniqueOrThrow({ where: { id: payment.orderId } });
    return {
      outcome,
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
    };
  } catch (error) {
    await finishEvent(ev.id, error);
    throw error;
  }
}

/** Customer dismissed the checkout modal or the payment failed client-side. Informational only. */
export async function recordClientPaymentFailure(
  razorpayOrderId: string,
  info: { code?: string; description?: string; paymentId?: string },
) {
  const payment = await db.payment.findUnique({ where: { razorpayOrderId } });
  if (!payment) return;
  if (info.paymentId) {
    // Confirm with the gateway rather than trusting the client.
    try {
      const gp = await paymentGateway().fetchPayment(info.paymentId);
      if (gp.orderId === razorpayOrderId && gp.status === "failed") await applyFailedPayment(gp);
    } catch (error) {
      logger.warn("Could not confirm client-reported failure", { error });
    }
  }
}

// ───────────────────────────── Webhooks ─────────────────────────────

type WebhookBody = {
  event: string;
  payload: {
    payment?: { entity: Record<string, unknown> };
    order?: { entity: Record<string, unknown> };
    refund?: { entity: Record<string, unknown> };
  };
};

function toGatewayPayment(e: Record<string, unknown>): GatewayPayment {
  return {
    id: String(e.id),
    orderId: String(e.order_id),
    status: e.status as GatewayPayment["status"],
    amount: Number(e.amount),
    currency: String(e.currency ?? "INR"),
    method: (e.method as string) ?? null,
    errorCode: (e.error_code as string) ?? null,
    errorDescription: (e.error_description as string) ?? null,
  };
}

/** Current secret plus, during rotation, the previous one (Razorpay may sign retries with it). */
function webhookSecrets() {
  return [process.env.RAZORPAY_WEBHOOK_SECRET, process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS].filter(
    (s): s is string => Boolean(s),
  );
}

/**
 * Receives a Razorpay webhook and acknowledges it fast (Razorpay times out after 5 s and resends).
 * Only verification and storage happen here: the signature is checked over the exact raw body, the
 * event is stored once (x-razorpay-event-id) and a processing job is enqueued in the same transaction.
 * A redelivered event that was never processed successfully gets its job revived.
 */
export async function handleRazorpayWebhook(
  rawBody: string,
  signature: string | null,
  eventIdHeader: string | null,
) {
  const secrets = webhookSecrets();
  if (!secrets.some((secret) => verifyWebhookSignature({ rawBody, signature, secret }))) {
    logger.warn("Rejected webhook with invalid signature");
    throw new AppError("FORBIDDEN", "Invalid webhook signature");
  }
  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
    if (typeof body.event !== "string" || typeof body.payload !== "object" || !body.payload)
      throw new Error("shape");
  } catch {
    throw new AppError("VALIDATION_ERROR", "Malformed webhook payload");
  }
  const eventId =
    eventIdHeader?.slice(0, 100) || `body:${createHash("sha256").update(rawBody).digest("hex")}`;
  const razorpayOrderId =
    (body.payload.payment?.entity?.order_id as string | undefined) ??
    (body.payload.order?.entity?.id as string | undefined) ??
    null;

  const seen = await db.paymentEvent.findUnique({ where: { eventId } });
  if (seen) {
    if (!seen.processedAt) {
      // Earlier processing failed and may have exhausted its retries: give it a fresh set.
      const job = await db.job.findUnique({ where: { dedupeKey: `rzp-event:${seen.id}` } });
      if (job && (job.status === "DEAD" || job.status === "SUCCEEDED")) await retryJob(job.id);
      else if (!job)
        await enqueue(
          "payments.webhook",
          { eventId: seen.id },
          { dedupeKey: `rzp-event:${seen.id}` },
        );
    }
    return { duplicate: true, event: body.event };
  }
  const payment = razorpayOrderId
    ? await db.payment.findUnique({ where: { razorpayOrderId } })
    : null;
  try {
    await db.$transaction(async (tx) => {
      const ev = await tx.paymentEvent.create({
        data: {
          eventId,
          eventType: body.event,
          source: "webhook",
          signatureValid: true,
          payload: body as unknown as Prisma.InputJsonValue,
          paymentId: payment?.id ?? null,
          orderId: payment?.orderId ?? null,
        },
      });
      await enqueue(
        "payments.webhook",
        { eventId: ev.id },
        { tx, dedupeKey: `rzp-event:${ev.id}`, priority: 10 },
      );
    });
  } catch (error) {
    // Concurrent delivery of the same event: the other request stored it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return { duplicate: true, event: body.event };
    throw error;
  }
  return { duplicate: false, event: body.event };
}

/** Job: applies a stored, signature-verified webhook event. Idempotent; failures retry with backoff. */
export async function processWebhookEvent(id: string, ctx?: JobContext) {
  const ev = await db.paymentEvent.findUnique({ where: { id } });
  if (!ev || ev.processedAt) return;
  const body = ev.payload as unknown as WebhookBody;
  const paymentEntity = body.payload.payment?.entity;
  const refundEntity = body.payload.refund?.entity;
  try {
    switch (body.event) {
      case "payment.captured":
      case "order.paid":
        if (paymentEntity && paymentEntity.status === "captured")
          await applyCapturedPayment(toGatewayPayment(paymentEntity), "webhook");
        break;
      case "payment.failed":
        if (paymentEntity) await applyFailedPayment(toGatewayPayment(paymentEntity));
        break;
      case "payment.authorized":
        // Auto-capture is expected to be enabled; the captured event confirms the order.
        break;
      case "refund.processed":
      case "refund.failed":
        if (refundEntity) await applyRefundWebhook(refundEntity, body.event === "refund.processed");
        break;
      default:
        logger.info("Ignoring unhandled webhook event", { event: body.event });
    }
    await finishEvent(ev.id);
  } catch (error) {
    await finishEvent(ev.id, error);
    if (ctx?.isLastAttempt)
      logger.error("Webhook event could not be processed; retry it from Admin → Payments", {
        event: body.event,
        eventId: ev.eventId,
      });
    throw error;
  }
}

/** Operator action: process a stored event again (e.g. after fixing data). */
export async function retryWebhookEvent(id: string) {
  const ev = await db.paymentEvent.findUnique({ where: { id } });
  if (!ev) throw new AppError("NOT_FOUND", "Event not found");
  if (ev.source !== "webhook" || !ev.signatureValid)
    throw new AppError("INVALID_STATE", "Only verified webhook events can be retried");
  if (ev.processedAt) throw new AppError("INVALID_STATE", "This event was already processed");
  const job = await db.job.findUnique({ where: { dedupeKey: `rzp-event:${id}` } });
  if (job && !(await retryJob(job.id)) && job.status !== "QUEUED" && job.status !== "RUNNING")
    throw new AppError("CONFLICT", "Could not retry this event");
  if (!job) await enqueue("payments.webhook", { eventId: id }, { dedupeKey: `rzp-event:${id}` });
}

// ───────────────────────────── Reconciliation ─────────────────────────────

/**
 * Pulls the authoritative payment state for an order from the gateway. Used before expiring
 * unpaid orders, and by admins to resolve "awaiting payment" orders after interrupted checkouts.
 */
export async function reconcileOrderPayments(orderId: string): Promise<"paid" | "unpaid"> {
  const payments = await db.payment.findMany({
    where: { orderId, method: "RAZORPAY", razorpayOrderId: { not: null } },
  });
  const gateway = paymentGateway();
  for (const p of payments) {
    const remote = await gateway.fetchOrderPayments(p.razorpayOrderId!);
    const captured = remote.find((r) => r.status === "captured");
    if (captured) {
      await applyCapturedPayment(captured, "reconcile");
      return "paid";
    }
    const failed = remote.find((r) => r.status === "failed");
    if (failed && p.status === "CREATED") await applyFailedPayment(failed);
  }
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  return order.paymentStatus === "PAID" ? "paid" : "unpaid";
}

/** Cancels online-payment orders whose reservation window lapsed (after checking the gateway). */
export async function expireStalePendingOrders(limit = 50) {
  const stale = await db.order.findMany({
    where: {
      status: { in: [...AWAITING_PAYMENT] },
      paymentMethod: "RAZORPAY",
      paymentStatus: { not: "PAID" },
      paymentExpiresAt: { lt: new Date() },
    },
    select: { id: true, orderNumber: true },
    take: limit,
  });
  let cancelled = 0;
  for (const o of stale) {
    try {
      if ((await reconcileOrderPayments(o.id)) === "paid") continue;
      await db.$transaction((tx) =>
        transitionOrder(tx, {
          orderId: o.id,
          to: "CANCELLED",
          actor: SYSTEM,
          note: "Payment not completed in time",
          restockReason: "PAYMENT_EXPIRED",
        }),
      );
      cancelled++;
    } catch (error) {
      logger.error("Failed to expire order", { orderNumber: o.orderNumber, error });
    }
  }
  return { checked: stale.length, cancelled };
}

// ───────────────────────────── Refunds ─────────────────────────────

/**
 * Issues a refund. The amount is reserved first (conditional update keeps refunded ≤ total even under
 * concurrency), then the gateway is called, then the outcome is recorded.
 */
export async function createRefund(p: {
  orderId: string;
  amountPaise: number;
  reason: string;
  actor: Actor;
  razorpayPaymentId?: string;
  /** Return request this refund settles (one live refund per request, enforced by the database). */
  requestId?: string;
}) {
  if (!Number.isInteger(p.amountPaise) || p.amountPaise <= 0)
    throw new AppError("VALIDATION_ERROR", "Refund amount must be positive");
  const order = await db.order.findUnique({
    where: { id: p.orderId },
    include: { payments: true },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found");
  if (order.paymentStatus !== "PAID" && order.paymentStatus !== "PARTIALLY_REFUNDED") {
    throw new AppError("INVALID_STATE", "Only paid orders can be refunded");
  }
  const captured = p.razorpayPaymentId
    ? order.payments.find((x) => x.razorpayPaymentId === p.razorpayPaymentId)
    : (order.payments.find((x) => x.method === "RAZORPAY" && x.status === "CAPTURED") ?? null);
  const method = order.paymentMethod === "RAZORPAY" && captured ? "RAZORPAY" : "MANUAL";

  const refund = await db
    .$transaction(async (tx) => {
      if (p.requestId) {
        // Serialise refunds of the same return: the second waits here, then sees the first.
        await tx.$queryRaw`SELECT id FROM "OrderRequest" WHERE id = ${p.requestId} FOR UPDATE`;
        const live = await tx.refund.findFirst({
          where: { requestId: p.requestId, status: { not: "FAILED" } },
          select: { id: true },
        });
        if (live) throw new AppError("CONFLICT", "This return has already been refunded");
      }
      const reserved = await tx.$executeRaw`
      UPDATE "Order" SET "refundedPaise" = "refundedPaise" + ${p.amountPaise}
      WHERE id = ${order.id} AND "refundedPaise" + ${p.amountPaise} <= "totalPaise"`;
      if (reserved === 0)
        throw new AppError("BUSINESS_RULE", "Refund exceeds the refundable amount");
      // A full refund of a cancelled/returned/delivered order puts it in REFUND_PENDING until settled.
      const after = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      if (after.refundedPaise >= after.totalPaise && REFUND_STARTABLE.includes(after.status))
        await transitionOrder(tx, {
          orderId: order.id,
          to: "REFUND_PENDING",
          actor: p.actor,
          note: p.reason.slice(0, 200),
        });
      return tx.refund.create({
        data: {
          orderId: order.id,
          paymentId: captured?.id ?? null,
          amountPaise: p.amountPaise,
          reason: p.reason,
          method,
          status: "PENDING",
          createdById: p.actor.id ?? null,
          requestId: p.requestId ?? null,
        },
      });
    })
    .catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
        throw new AppError("CONFLICT", "This return has already been refunded");
      throw e;
    });

  if (method === "MANUAL") {
    await settleRefund(refund.id, true, null);
    return db.refund.findUniqueOrThrow({ where: { id: refund.id } });
  }
  try {
    const r = await paymentGateway().refund({
      paymentId: captured!.razorpayPaymentId!,
      amountPaise: p.amountPaise,
      notes: { orderNumber: order.orderNumber, refundId: refund.id },
    });
    await db.refund.update({ where: { id: refund.id }, data: { razorpayRefundId: r.id } });
    if (r.status === "processed") await settleRefund(refund.id, true, null);
    else if (r.status === "failed")
      await settleRefund(refund.id, false, "Gateway reported failure");
  } catch (error) {
    if (error instanceof GatewayError && error.definitive) {
      // Razorpay refused: nothing was refunded, so the reserved amount is released.
      await settleRefund(refund.id, false, error.message);
      throw error;
    }
    // Timeout / network / 5xx: the refund may or may not exist at Razorpay. Keep the amount reserved
    // and the refund PENDING; reconciliation (matched by notes.refundId) decides before any retry.
    logger.warn("Refund outcome unknown; will reconcile with Razorpay", {
      refundId: refund.id,
      error,
    });
    await enqueue(
      "payments.reconcile-refund",
      { refundId: refund.id },
      { delayMs: 60_000, dedupeKey: `reconcile-refund:${refund.id}` },
    );
  }
  return db.refund.findUniqueOrThrow({ where: { id: refund.id } });
}

const UNKNOWN_REFUND_GRACE_MS = 10 * 60_000;

/**
 * Settles a PENDING Razorpay refund from Razorpay's own records. A refund whose creation outcome was
 * unknown is matched by `notes.refundId`; if Razorpay has no such refund after a grace period it was
 * never created, and the reserved amount is released (so it can be refunded again safely).
 * Gateway errors propagate so the job retries.
 */
export async function reconcileRefund(refundId: string) {
  const r = await db.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
  if (!r || r.status !== "PENDING" || r.method !== "RAZORPAY") return "settled" as const;
  const paymentId = r.payment?.razorpayPaymentId;
  if (!paymentId) return "pending" as const;
  const list = await paymentGateway().fetchRefunds(paymentId);
  const match = r.razorpayRefundId
    ? list.find((x) => x.id === r.razorpayRefundId)
    : list.find((x) => x.notes?.refundId === r.id);
  if (match) {
    if (!r.razorpayRefundId)
      await db.refund.update({ where: { id: r.id }, data: { razorpayRefundId: match.id } });
    if (match.status === "processed") {
      await settleRefund(r.id, true, null);
      return "processed" as const;
    }
    if (match.status === "failed") {
      await settleRefund(r.id, false, "Refund failed at Razorpay");
      return "failed" as const;
    }
    return "pending" as const;
  }
  if (!r.razorpayRefundId && Date.now() - r.createdAt.getTime() > UNKNOWN_REFUND_GRACE_MS) {
    await settleRefund(r.id, false, "Refund was not created at Razorpay");
    return "failed" as const;
  }
  return "pending" as const;
}

/**
 * Scheduled safety net: confirms online-payment attempts that never reported back (closed tab plus a
 * missed webhook) and settles refunds still pending at Razorpay.
 */
export async function reconcilePayments(limit = 50) {
  const staleAttemptCutoff = new Date(Date.now() - 10 * 60_000);
  const attempts = await db.payment.findMany({
    where: {
      method: "RAZORPAY",
      status: { in: ["CREATED", "AUTHORIZED"] },
      createdAt: { lt: staleAttemptCutoff },
      order: { status: { in: [...AWAITING_PAYMENT] }, paymentMethod: "RAZORPAY" },
    },
    select: { orderId: true },
    distinct: ["orderId"],
    take: limit,
  });
  let confirmed = 0;
  for (const a of attempts) {
    try {
      if ((await reconcileOrderPayments(a.orderId)) === "paid") confirmed++;
    } catch (error) {
      logger.warn("Payment reconciliation failed for an order", { orderId: a.orderId, error });
    }
  }
  const refunds = await db.refund.findMany({
    where: {
      status: "PENDING",
      method: "RAZORPAY",
      createdAt: { lt: new Date(Date.now() - 15 * 60_000) },
    },
    select: { id: true },
    take: limit,
  });
  let settled = 0;
  for (const r of refunds) {
    try {
      if ((await reconcileRefund(r.id)) !== "pending") settled++;
    } catch (error) {
      logger.warn("Refund reconciliation failed", { refundId: r.id, error });
    }
  }
  return {
    attemptsChecked: attempts.length,
    confirmed,
    refundsChecked: refunds.length,
    refundsSettled: settled,
  };
}

/** Finalises a refund (idempotent). Failure returns the reserved amount. */
async function settleRefund(refundId: string, success: boolean, failureReason: string | null) {
  await db.$transaction(async (tx) => {
    const r = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    if (r.status !== "PENDING") return;
    if (r.reason.startsWith(DUPLICATE_PREFIX)) {
      // Duplicate-payment refunds never touched the order's refundable total.
      await tx.refund.update({
        where: { id: refundId },
        data: success
          ? { status: "PROCESSED", processedAt: new Date() }
          : { status: "FAILED", failureReason },
      });
      return;
    }
    await tx.refund.update({
      where: { id: refundId },
      data: success
        ? { status: "PROCESSED", processedAt: new Date() }
        : { status: "FAILED", failureReason: failureReason?.slice(0, 300) ?? null },
    });
    if (!success) {
      const o = await tx.order.update({
        where: { id: r.orderId },
        data: { refundedPaise: { decrement: r.amountPaise } },
      });
      if (o.status === "REFUND_PENDING")
        await tx.order.update({
          where: { id: o.id },
          data: { requiresAttention: true, attentionReason: "Refund failed — retry the refund" },
        });
      await queueStaffAlert(tx, {
        kind: "refund_failed",
        orderId: o.id,
        dedupeKey: refundId,
        extra: `${formatINRExact(r.amountPaise)}${failureReason ? ` — ${failureReason.slice(0, 150)}` : ""}`,
      });
      return;
    }
    const order = await tx.order.findUniqueOrThrow({ where: { id: r.orderId } });
    const full = order.refundedPaise >= order.totalPaise;
    await tx.order.update({
      where: { id: order.id },
      data: { paymentStatus: full ? "REFUNDED" : "PARTIALLY_REFUNDED" },
    });
    if (r.paymentId) {
      await tx.payment.update({
        where: { id: r.paymentId },
        data: { status: full ? "REFUNDED" : "PARTIALLY_REFUNDED" },
      });
    }
    // GST: money returned on an invoiced order is documented by a credit note.
    await issueCreditNoteForRefund(tx, refundId);
    if (full && REFUND_COMPLETABLE.includes(order.status)) {
      await transitionOrder(tx, {
        orderId: order.id,
        to: "REFUNDED",
        actor: SYSTEM,
        note: "Fully refunded",
      });
    }
    await queueOrderEmail(tx, {
      orderId: order.id,
      kind: "refunded",
      extra: formatINRExact(r.amountPaise),
      dedupeKey: refundId,
    });
  });
}

async function applyRefundWebhook(entity: Record<string, unknown>, processed: boolean) {
  const refund = await db.refund.findUnique({ where: { razorpayRefundId: String(entity.id) } });
  if (!refund) return;
  await settleRefund(refund.id, processed, processed ? null : "Refund failed at gateway");
}

/** Full refund of a specific captured payment (duplicate payments / unfulfillable late captures). */
async function refundCapturedPayment(orderId: string, razorpayPaymentId: string, reason: string) {
  const payment = await db.payment.findUnique({ where: { razorpayPaymentId } });
  if (!payment) return;
  try {
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    const otherCapture = await db.payment.findFirst({
      where: { orderId, status: "CAPTURED", NOT: { id: payment.id } },
    });
    if (otherCapture) {
      // Duplicate payment: refund it outside the order's own accounting. This runs as a retryable
      // job, so first check Razorpay for a refund we already issued for this payment.
      const gateway = paymentGateway();
      const existing = (await gateway.fetchRefunds(razorpayPaymentId)).find(
        (x) => x.notes?.reason === "duplicate",
      );
      if (existing && (await db.refund.findUnique({ where: { razorpayRefundId: existing.id } })))
        return; // already recorded by an earlier run
      const r =
        existing ??
        (await gateway.refund({
          paymentId: razorpayPaymentId,
          amountPaise: payment.amountPaise,
          notes: { orderNumber: order.orderNumber, reason: "duplicate" },
        }));
      await db.$transaction([
        db.refund.create({
          data: {
            orderId,
            paymentId: payment.id,
            amountPaise: payment.amountPaise,
            reason: `${DUPLICATE_PREFIX}${reason}`,
            method: "RAZORPAY",
            razorpayRefundId: r.id,
            status: r.status === "processed" ? "PROCESSED" : "PENDING",
            processedAt: r.status === "processed" ? new Date() : null,
          },
        }),
        db.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } }),
      ]);
      return;
    }
    if (order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_REFUNDED") {
      await createRefund({
        orderId,
        amountPaise: payment.amountPaise,
        reason,
        actor: SYSTEM,
        razorpayPaymentId,
      });
    }
  } catch (error) {
    logger.error("Automatic refund failed; flagged for admin", { orderId, error });
    await db.order.update({
      where: { id: orderId },
      data: { requiresAttention: true, attentionReason: `Automatic refund failed: ${reason}` },
    });
  }
}
