import type { ActorType, InventoryReason, OrderStatus, Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/platform/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/server/platform/logger";
import { moveStock } from "@/server/modules/inventory/inventory";
import { canTransition, STOCK_HOLDING_STATUSES } from "@/server/modules/orders/order-status";
import { queueOrderEmail } from "@/server/modules/notifications/notifications";
import type { OrderEmailKind } from "@/server/modules/notifications/order-emails";

const STATUS_EMAIL: Partial<Record<OrderStatus, OrderEmailKind>> = {
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
  SHIPPED: "shipped",
  DELIVERED: "delivered",
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
  const data: Prisma.OrderUpdateManyMutationInput = { status: p.to };
  if (p.to === "CONFIRMED") data.confirmedAt = now;
  if (p.to === "SHIPPED") data.shippedAt = now;
  if (p.to === "DELIVERED") data.deliveredAt = now;
  if (p.to === "CANCELLED") {
    data.cancelledAt = now;
    data.cancelReason = p.note ?? null;
    data.paymentExpiresAt = null;
  }
  if (p.to === "DELIVERED" && order.paymentMethod === "COD") data.paymentStatus = "PAID";

  const updated = await tx.order.updateMany({ where: { id: order.id, status: from }, data });
  if (updated.count === 0)
    throw new AppError("CONFLICT", "The order was updated by someone else. Please refresh.");

  await tx.orderStatusHistory.create({
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
  const emailKind = STATUS_EMAIL[p.to];
  if (emailKind) await queueOrderEmail(tx, { orderId: order.id, kind: emailKind });

  if (p.to === "CONFIRMED") {
    for (const item of order.items) {
      if (item.productId) {
        await tx.product.update({
          where: { id: item.productId },
          data: { salesCount: { increment: item.quantity } },
        });
      }
    }
  }

  if (p.to === "CANCELLED" && STOCK_HOLDING_STATUSES.includes(from)) {
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
        note: `Released from ${order.orderNumber}`,
      });
    }
    if (from !== "PENDING") {
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

  if (p.to === "DELIVERED") {
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
  shipments: { orderBy: { createdAt: "desc" } },
  refunds: { orderBy: { createdAt: "desc" } },
  invoice: { select: { invoiceNumber: true, issuedAt: true } },
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
