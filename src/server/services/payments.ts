import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { sendOrderEmail } from "@/server/email/order-emails";
import { paymentGateway, type GatewayPayment } from "@/server/payments/gateway";
import { verifyCheckoutSignature, verifyWebhookSignature } from "@/server/payments/signature";
import { moveStock } from "@/server/services/inventory";
import { transitionOrder, type Actor } from "@/server/services/orders";

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
  if (order.status !== "PENDING")
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

    if (order.status === "PENDING") {
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
  });

  if (result.orderId && result.outcome === "confirmed") {
    void sendOrderEmail(result.orderId, "confirmed");
  }

  if (result.outcome === "refund_required" && result.orderId) {
    if (result.needsReinstate && (await tryReinstateCancelledOrder(result.orderId, gp.id)))
      return "reinstated";
    await refundCapturedPayment(
      result.orderId,
      gp.id,
      "Payment received for an order that could not be fulfilled",
    );
  }
  return result.outcome;
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
        await moveStock(tx, {
          variantId: item.variantId,
          delta: -item.quantity,
          reason: "ORDER_PLACED",
          orderId,
          note: "Re-reserved after late payment",
        });
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
    });
    void sendOrderEmail(orderId, "confirmed");
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
    if (payment.order.status === "PENDING" && payment.order.paymentStatus !== "PAID") {
      await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: "FAILED" } });
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

/**
 * Processes a Razorpay webhook. Signature is verified over the exact raw body.
 * Duplicate deliveries (same x-razorpay-event-id) are acknowledged without reprocessing.
 */
export async function handleRazorpayWebhook(
  rawBody: string,
  signature: string | null,
  eventIdHeader: string | null,
) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  if (!verifyWebhookSignature({ rawBody, signature, secret })) {
    logger.warn("Rejected webhook with invalid signature");
    throw new AppError("FORBIDDEN", "Invalid webhook signature");
  }
  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    throw new AppError("VALIDATION_ERROR", "Malformed webhook payload");
  }
  const eventId =
    eventIdHeader?.slice(0, 100) || `body:${createHash("sha256").update(rawBody).digest("hex")}`;
  const paymentEntity = body.payload.payment?.entity;
  const refundEntity = body.payload.refund?.entity;
  const razorpayOrderId =
    (paymentEntity?.order_id as string | undefined) ??
    (body.payload.order?.entity.id as string | undefined) ??
    null;

  const ev = await recordEvent({
    eventId,
    eventType: body.event,
    source: "webhook",
    signatureValid: true,
    payload: body,
    razorpayOrderId,
  });
  if (!ev.fresh) return { duplicate: true, event: body.event };

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
    return { duplicate: false, event: body.event };
  } catch (error) {
    await finishEvent(ev.id, error);
    throw error;
  }
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
      status: "PENDING",
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

let lastSweep = 0;
/** Opportunistic, throttled sweep (no background worker needed in development). */
export function maybeExpireStaleOrders() {
  if (process.env.NODE_ENV === "test") return;
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  void expireStalePendingOrders().catch((error) =>
    logger.error("Stale order sweep failed", { error }),
  );
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

  const refund = await db.$transaction(async (tx) => {
    const reserved = await tx.$executeRaw`
      UPDATE "Order" SET "refundedPaise" = "refundedPaise" + ${p.amountPaise}
      WHERE id = ${order.id} AND "refundedPaise" + ${p.amountPaise} <= "totalPaise"`;
    if (reserved === 0) throw new AppError("BUSINESS_RULE", "Refund exceeds the refundable amount");
    return tx.refund.create({
      data: {
        orderId: order.id,
        paymentId: captured?.id ?? null,
        amountPaise: p.amountPaise,
        reason: p.reason,
        method,
        status: "PENDING",
        createdById: p.actor.id ?? null,
      },
    });
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
    await settleRefund(refund.id, false, error instanceof Error ? error.message : "Gateway error");
    throw error;
  }
  return db.refund.findUniqueOrThrow({ where: { id: refund.id } });
}

/** Finalises a refund (idempotent). Failure returns the reserved amount. */
async function settleRefund(refundId: string, success: boolean, failureReason: string | null) {
  let refunded = false;
  let orderId = "";
  let amount = 0;
  await db.$transaction(async (tx) => {
    const r = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    orderId = r.orderId;
    amount = r.amountPaise;
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
      await tx.order.update({
        where: { id: r.orderId },
        data: { refundedPaise: { decrement: r.amountPaise } },
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
    if (full && (order.status === "CANCELLED" || order.status === "DELIVERED")) {
      await transitionOrder(tx, {
        orderId: order.id,
        to: "REFUNDED",
        actor: SYSTEM,
        note: "Fully refunded",
      });
    }
    refunded = true;
  });
  if (refunded) void sendOrderEmail(orderId, "refunded", `₹${(amount / 100).toFixed(2)}`);
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
      // Duplicate payment: refund it outside the order's own accounting.
      const r = await paymentGateway().refund({
        paymentId: razorpayPaymentId,
        amountPaise: payment.amountPaise,
        notes: { orderNumber: order.orderNumber, reason: "duplicate" },
      });
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
