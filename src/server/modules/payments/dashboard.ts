import "server-only";
import { z } from "zod";
import type { PaymentAttemptStatus, Prisma } from "@prisma/client";
import { db } from "@/server/platform/db";
import { AWAITING_PAYMENT } from "@/server/modules/orders/order-status";

export const paymentListSchema = z.object({
  status: z
    .enum(["CREATED", "AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"])
    .optional()
    .catch(undefined),
  method: z.enum(["RAZORPAY", "COD"]).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
});

const STUCK_EVENT_MS = 2 * 60_000;

/** Figures and work queues for Admin → Payments. Read-only. */
export async function getPaymentsDashboard(f: z.infer<typeof paymentListSchema>) {
  const now = Date.now();
  const startOfDay = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T00:00:00+05:30",
  );
  const weekAgo = new Date(now - 7 * 86_400_000);
  const monthAgo = new Date(now - 30 * 86_400_000);
  const where: Prisma.PaymentWhereInput = {
    ...(f.status ? { status: f.status as PaymentAttemptStatus } : {}),
    ...(f.method ? { method: f.method } : {}),
    ...(f.q
      ? {
          OR: [
            { razorpayPaymentId: { contains: f.q } },
            { razorpayOrderId: { contains: f.q } },
            { order: { orderNumber: { contains: f.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [
    today,
    week,
    failedWeek,
    pendingRefunds,
    processedRefunds,
    awaiting,
    stuckEvents,
    payments,
    refundQueue,
    eventQueue,
  ] = await Promise.all([
    db.payment.aggregate({
      where: { status: "CAPTURED", capturedAt: { gte: startOfDay } },
      _sum: { amountPaise: true },
      _count: true,
    }),
    db.payment.aggregate({
      where: { status: "CAPTURED", capturedAt: { gte: weekAgo } },
      _sum: { amountPaise: true },
      _count: true,
    }),
    db.payment.count({ where: { status: "FAILED", updatedAt: { gte: weekAgo } } }),
    db.refund.aggregate({
      where: { status: "PENDING" },
      _sum: { amountPaise: true },
      _count: true,
    }),
    db.refund.aggregate({
      where: { status: "PROCESSED", processedAt: { gte: monthAgo } },
      _sum: { amountPaise: true },
      _count: true,
    }),
    db.order.count({ where: { status: { in: [...AWAITING_PAYMENT] }, paymentMethod: "RAZORPAY" } }),
    db.paymentEvent.count({
      where: {
        source: "webhook",
        processedAt: null,
        receivedAt: { lt: new Date(now - STUCK_EVENT_MS) },
      },
    }),
    db.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { order: { select: { id: true, orderNumber: true, status: true } } },
    }),
    db.refund.findMany({
      where: { OR: [{ status: "PENDING" }, { status: "FAILED", createdAt: { gte: monthAgo } }] },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { order: { select: { id: true, orderNumber: true } } },
    }),
    db.paymentEvent.findMany({
      where: {
        source: "webhook",
        OR: [
          { processedAt: null, receivedAt: { lt: new Date(now - STUCK_EVENT_MS) } },
          { processingError: { not: null }, processedAt: null },
        ],
      },
      orderBy: { receivedAt: "desc" },
      take: 20,
      select: {
        id: true,
        eventId: true,
        eventType: true,
        receivedAt: true,
        processingError: true,
        order: { select: { id: true, orderNumber: true } },
      },
    }),
  ]);
  return {
    tiles: {
      capturedToday: { paise: today._sum.amountPaise ?? 0, count: today._count },
      captured7d: { paise: week._sum.amountPaise ?? 0, count: week._count },
      failed7d: failedWeek,
      refundsPending: { paise: pendingRefunds._sum.amountPaise ?? 0, count: pendingRefunds._count },
      refunded30d: {
        paise: processedRefunds._sum.amountPaise ?? 0,
        count: processedRefunds._count,
      },
      awaitingPayment: awaiting,
      stuckEvents,
    },
    payments,
    refundQueue,
    eventQueue,
  };
}
