import type { ActorType, InventoryReason, OrderStatus, Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/platform/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/server/platform/logger";
import { enqueue } from "@/server/platform/jobs/queue";
import {
  clearReservationExpiry,
  consumeReservations,
  moveStock,
  releaseReservations,
} from "@/server/modules/inventory/inventory";
import {
  AWAITING_PAYMENT,
  canTransition,
  STOCK_DEDUCT_STATUSES,
  STOCK_HOLDING_STATUSES,
} from "@/server/modules/orders/order-status";
import { queueOrderEmail } from "@/server/modules/notifications/notifications";
import { queueStaffAlert } from "@/server/modules/notifications/staff-alerts";
import type { OrderEmailKind } from "@/server/modules/notifications/order-emails";

const STATUS_EMAIL: Partial<Record<OrderStatus, OrderEmailKind>> = {
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
  SHIPPED: "shipped",
  OUT_FOR_DELIVERY: "out_for_delivery",
  DELIVERED: "delivered",
  CANCELLATION_REQUESTED: "cancellation_requested",
  RETURN_REQUESTED: "return_requested",
  RETURNED: "returned",
};

export type Actor = { type: ActorType; id?: string | null };

/**
 * Moves an order to a new status inside the caller's transaction.
 * Uses a compare-and-set on the current status so concurrent transitions cannot both succeed.
 */
export async function transitionOrder(
  tx: Tx,
  p: {
    orderId: string;
    to: OrderStatus;
    actor: Actor;
    note?: string | null;
    restockReason?: InventoryReason;
  },
) {
  const order = await tx.order.findUnique({ where: { id: p.orderId }, include: { items: true } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found");
  const from = order.status;
  if (!canTransition(from, p.to)) {
    throw new AppError(
      "INVALID_STATE",
      `An order cannot move from ${from.toLowerCase()} to ${p.to.toLowerCase()}`,
    );
  }

  const now = new Date();
  // Returning to an earlier status (request rejected/withdrawn, failed delivery attempt) must not
  // repeat first-time side effects: emails, sales counts, timestamps, COD capture.
  const restoring =
    (from === "CANCELLATION_REQUESTED" && p.to !== "CANCELLED") ||
    (from === "RETURN_REQUESTED" && p.to === "DELIVERED") ||
    (from === "OUT_FOR_DELIVERY" && p.to === "SHIPPED");
  const data: Prisma.OrderUpdateManyMutationInput = { status: p.to };
  if (p.to === "CONFIRMED" && !restoring) data.confirmedAt = now;
  if (p.to === "SHIPPED" && !order.shippedAt) data.shippedAt = now;
  if (p.to === "DELIVERED" && !restoring) data.deliveredAt = now;
  if (p.to === "CANCELLED") {
    data.cancelledAt = now;
    data.cancelReason = p.note ?? null;
    data.paymentExpiresAt = null;
  }
  if (p.to === "DELIVERED" && !restoring && order.paymentMethod === "COD")
    data.paymentStatus = "PAID";

  const updated = await tx.order.updateMany({ where: { id: order.id, status: from }, data });
  if (updated.count === 0)
    throw new AppError("CONFLICT", "The order was updated by someone else. Please refresh.");

  const history = await tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      fromStatus: from,
      toStatus: p.to,
      note: p.note ?? null,
      actorType: p.actor.type,
      actorId: p.actor.id ?? null,
    },
  });

  // ── Side effects ──
  // Customer notification is part of the same transaction (outbox), delivered by the job worker.
  const emailKind = restoring ? undefined : STATUS_EMAIL[p.to];
  if (emailKind)
    await queueOrderEmail(tx, { orderId: order.id, kind: emailKind, dedupeKey: history.id });

  // Staff alerts (outbox, only when alert emails are configured). A new order alerts once per order.
  if (!restoring) {
    if (p.to === "CONFIRMED")
      await queueStaffAlert(tx, { kind: "new_order", orderId: order.id, dedupeKey: order.id });
    if (p.to === "CANCELLATION_REQUESTED" || p.to === "RETURN_REQUESTED")
      await queueStaffAlert(tx, {
        kind: p.to === "CANCELLATION_REQUESTED" ? "cancellation_requested" : "return_requested",
        orderId: order.id,
        dedupeKey: history.id,
        extra: p.note ? `Reason: ${p.note.slice(0, 200)}` : null,
      });
  }

  // Optional automatic invoice on delivery (Settings). Issued by a job: idempotent, retried on failure.
  if (p.to === "DELIVERED" && !restoring) {
    const s = await tx.storeSettings.findUnique({
      where: { id: "default" },
      select: { autoIssueInvoice: true },
    });
    if (s?.autoIssueInvoice)
      await enqueue(
        "invoices.issue",
        { orderId: order.id },
        { tx, dedupeKey: `invoice:${order.id}` },
      );
  }

  if (p.to === "CONFIRMED") await clearReservationExpiry(tx, order.id);

  if (STOCK_DEDUCT_STATUSES.includes(p.to)) {
    // Idempotent: only ACTIVE reservations are consumed, so READY_TO_SHIP → SHIPPED deducts nothing more.
    await consumeReservations(tx, order.id, {
      actorId: p.actor.id ?? null,
      note: `${p.to === "READY_TO_SHIP" ? "Packed" : "Shipped"} ${order.orderNumber}`,
    });
  }

  if (p.to === "CONFIRMED" && !restoring) {
    for (const item of order.items) {
      if (item.productId) {
        await tx.product.update({
          where: { id: item.productId },
          data: { salesCount: { increment: item.quantity } },
        });
      }
    }
  }

  if (p.to === "CANCELLED") {
    // Courier bookings that have not been picked up are cancelled at the provider (job, retried).
    const booked = await tx.shipment.findMany({
      where: {
        orderId: order.id,
        provider: { not: "manual" },
        isReturn: false,
        status: { in: ["PENDING", "CREATING", "CREATED", "AWB_ASSIGNED", "PICKUP_SCHEDULED"] },
      },
      select: { id: true },
    });
    for (const s of booked)
      await enqueue(
        "shipping.cancel",
        { shipmentId: s.id, reason: `Order ${order.orderNumber} cancelled` },
        { tx, dedupeKey: `ship-cancel:${s.id}` },
      );
  }

  if (p.to === "CANCELLED" && STOCK_HOLDING_STATUSES.includes(from)) {
    await releaseReservations(tx, order.id, {
      actorId: p.actor.id ?? null,
      note: `Released from ${order.orderNumber}`,
    });
    // Packed (deducted) but never handed to the courier: the units are still in the warehouse.
    if (!order.shippedAt) {
      const consumed = await tx.inventoryReservation.findMany({
        where: { orderId: order.id, status: "CONSUMED" },
      });
      for (const r of consumed) {
        const claimed = await tx.inventoryReservation.updateMany({
          where: { id: r.id, status: "CONSUMED" },
          data: { status: "RELEASED", resolvedAt: now },
        });
        if (claimed.count === 0) continue;
        await moveStock(tx, {
          variantId: r.variantId,
          delta: r.quantity,
          reason: "ORDER_CANCELLED",
          orderId: order.id,
          actorId: p.actor.id ?? null,
          note: `Packed order ${order.orderNumber} cancelled before pickup`,
        });
      }
    }
    const reservationCount = await tx.inventoryReservation.count({ where: { orderId: order.id } });
    if (reservationCount === 0) {
      // Orders placed before reservations existed took units off-hand at placement; put them back.
      for (const item of order.items) {
        if (!item.variantId) continue;
        const exists = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          select: { id: true },
        });
        if (!exists) continue;
        await moveStock(tx, {
          variantId: item.variantId,
          delta: item.quantity,
          reason: p.restockReason ?? "ORDER_CANCELLED",
          orderId: order.id,
          actorId: p.actor.id ?? null,
          note: `Released from ${order.orderNumber} (pre-reservation order)`,
        });
      }
    }
    if (!AWAITING_PAYMENT.includes(from)) {
      for (const item of order.items) {
        if (item.productId) {
          await tx.product.updateMany({
            where: { id: item.productId, salesCount: { gte: item.quantity } },
            data: { salesCount: { decrement: item.quantity } },
          });
        }
      }
    }
    // Unpaid cancellations give the coupon back.
    if (order.paymentStatus !== "PAID") {
      const usage = await tx.couponUsage.findUnique({ where: { orderId: order.id } });
      if (usage) {
        await tx.couponUsage.delete({ where: { id: usage.id } });
        await tx.coupon.updateMany({
          where: { id: usage.couponId, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } },
        });
      }
    }
  }

  if (p.to === "DELIVERED" && !restoring) {
    if (order.paymentMethod === "COD") {
      await tx.payment.updateMany({
        where: { orderId: order.id, method: "COD" },
        data: { status: "CAPTURED", capturedAt: now },
      });
    }
    await tx.shipment.updateMany({
      where: { orderId: order.id, status: { not: "DELIVERED" } },
      data: { status: "DELIVERED", deliveredAt: now },
    });
  }

  logger.info("Order status changed", {
    orderNumber: order.orderNumber,
    from,
    to: p.to,
    actor: p.actor.type,
  });
  return { from, to: p.to, order };
}

export const orderDetailInclude = {
  items: true,
  statusHistory: { orderBy: { createdAt: "asc" } },
  payments: { orderBy: { createdAt: "asc" } },
  // Customer-facing: the live delivery shipment only (no return pickups or cancelled bookings).
  shipments: {
    where: { isReturn: false, status: { notIn: ["CANCELLED", "FAILED"] } },
    orderBy: { createdAt: "desc" },
    take: 1,
    include: {
      events: {
        where: { status: { not: null } },
        orderBy: { occurredAt: "desc" },
        take: 15,
        select: { id: true, status: true, activity: true, location: true, occurredAt: true },
      },
    },
  },
  refunds: {
    orderBy: { createdAt: "desc" },
    include: { creditNote: { select: { id: true, number: true } } },
  },
  invoice: { select: { invoiceNumber: true, issuedAt: true } },
  requests: { orderBy: { createdAt: "desc" }, take: 5 },
} satisfies Prisma.OrderInclude;

export async function listCustomerOrders(userId: string, page = 1, pageSize = 10) {
  const [total, orders] = await Promise.all([
    db.order.count({ where: { userId } }),
    db.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        items: { select: { productName: true, imageUrl: true, quantity: true } },
        invoice: { select: { invoiceNumber: true } },
      },
    }),
  ]);
  return { total, orders, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Customer order lookup — always scoped to the owner. */
export async function getCustomerOrder(userId: string, orderNumber: string) {
  const order = await db.order.findFirst({
    where: { orderNumber, userId },
    include: orderDetailInclude,
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found");
  return order;
}
