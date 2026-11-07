import {
  OrderStatus as OrderStatusEnum,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type Prisma,
} from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/platform/db";
import { AppError } from "@/lib/errors";
import { optionalTrimmed, trimmed } from "@/lib/validation/common";
import { audit } from "@/server/modules/audit/audit";
import {
  AWAITING_PAYMENT,
  BEFORE_HANDOVER,
  canTransition,
  REQUEST_DRIVEN,
} from "@/server/modules/orders/order-status";
import { orderDetailInclude, transitionOrder } from "@/server/modules/orders/orders";
import { createRefund, reconcileOrderPayments } from "@/server/modules/payments/payments";

type AdminActor = { id: string; ip?: string | null };

export const adminOrderFiltersSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(OrderStatusEnum).optional().catch(undefined),
  payment: z
    .enum(["PENDING", "PAID", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED"])
    .optional()
    .catch(undefined),
  method: z.enum(["COD", "RAZORPAY"]).optional().catch(undefined),
  attention: z.enum(["1"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});
export type AdminOrderFilters = z.infer<typeof adminOrderFiltersSchema>;

export async function listOrdersAdmin(f: AdminOrderFilters, pageSize = 20) {
  const where: Prisma.OrderWhereInput = {
    ...(f.status ? { status: f.status as OrderStatus } : {}),
    ...(f.payment ? { paymentStatus: f.payment as PaymentStatus } : {}),
    ...(f.method ? { paymentMethod: f.method as PaymentMethod } : {}),
    AND: [
      // "Needs attention" also covers open orders whose courier coverage could not be checked.
      ...(f.attention
        ? [
            {
              OR: [
                { requiresAttention: true },
                {
                  deliveryCheck: "UNVERIFIED" as const,
                  status: { in: [...AWAITING_PAYMENT, ...BEFORE_HANDOVER] },
                },
              ],
            },
          ]
        : []),
      ...(f.q
        ? [
            {
              OR: [
                { orderNumber: { contains: f.q, mode: "insensitive" as const } },
                { email: { contains: f.q, mode: "insensitive" as const } },
                { phone: { contains: f.q } },
              ],
            },
          ]
        : []),
    ],
  };
  const [total, orders] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        orderNumber: true,
        email: true,
        shippingAddress: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        totalPaise: true,
        requiresAttention: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
    }),
  ]);
  return { total, orders, page: f.page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getOrderAdmin(id: string) {
  const order = await db.order.findUnique({
    where: { id },
    include: {
      ...orderDetailInclude,
      user: { select: { id: true, name: true, email: true, phone: true } },
      reservations: { select: { variantId: true, quantity: true, status: true, expiresAt: true } },
      shipments: {
        orderBy: { createdAt: "desc" },
        include: { events: { orderBy: { occurredAt: "desc" }, take: 8 } },
      },
      paymentEvents: {
        orderBy: { receivedAt: "desc" },
        take: 30,
        select: {
          id: true,
          eventType: true,
          source: true,
          signatureValid: true,
          processedAt: true,
          processingError: true,
          receivedAt: true,
        },
      },
    },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found");
  return order;
}

export const statusUpdateSchema = z.object({
  // Request-, payment- and refund-driven statuses are set by those flows, not from the status menu.
  status: z.enum([
    "CONFIRMED",
    "PROCESSING",
    "READY_TO_SHIP",
    "SHIPPED",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "CANCELLED",
  ]),
  note: optionalTrimmed(300),
});

/**
 * Admin status change. Paid cancellations trigger a full refund; COD delivery marks the order paid.
 * Shipping requires a shipment record so customers always get tracking information.
 */
export async function updateOrderStatusAdmin(
  orderId: string,
  input: z.infer<typeof statusUpdateSchema>,
  actor: AdminActor,
) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { shipments: true } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found");
  if (REQUEST_DRIVEN.includes(order.status) && order.status !== "PAYMENT_FAILED") {
    throw new AppError(
      "INVALID_STATE",
      order.status === "CANCELLATION_REQUESTED" || order.status === "RETURN_REQUESTED"
        ? "The customer has an open request — approve or reject it first"
        : "This order’s status is managed by its refund",
    );
  }
  if (!canTransition(order.status, input.status)) {
    throw new AppError(
      "INVALID_STATE",
      `Cannot change status from ${order.status} to ${input.status}`,
    );
  }
  if (
    input.status === "CONFIRMED" &&
    order.paymentMethod === "RAZORPAY" &&
    order.paymentStatus !== "PAID"
  ) {
    throw new AppError(
      "BUSINESS_RULE",
      "Online orders are confirmed automatically once payment is verified. Use “Check payment status” instead.",
    );
  }
  if (input.status === "SHIPPED" && order.shipments.length === 0) {
    throw new AppError(
      "BUSINESS_RULE",
      "Add shipment details (carrier and tracking) before marking as shipped",
    );
  }
  await db.$transaction(async (tx) => {
    await transitionOrder(tx, {
      orderId,
      to: input.status,
      actor: { type: "ADMIN", id: actor.id },
      note: input.note,
    });
    if (input.status === "SHIPPED") {
      await tx.shipment.updateMany({
        where: { orderId, status: "PENDING" },
        data: { status: "SHIPPED", shippedAt: new Date() },
      });
    }
    await audit(
      {
        actorId: actor.id,
        action: "order.status",
        entityType: "Order",
        entityId: orderId,
        metadata: { from: order.status, to: input.status, note: input.note ?? null },
        ipAddress: actor.ip,
      },
      tx,
    );
  });
  if (input.status === "CANCELLED") {
    const fresh = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    if (fresh.paymentMethod === "RAZORPAY" && fresh.paymentStatus === "PAID") {
      await createRefund({
        orderId,
        amountPaise: fresh.totalPaise - fresh.refundedPaise,
        reason: input.note ?? "Order cancelled by store",
        actor: { type: "ADMIN", id: actor.id },
      });
    }
  }
  return db.order.findUniqueOrThrow({ where: { id: orderId } });
}

export const shipmentSchema = z.object({
  carrier: trimmed(2, 60, "Carrier"),
  trackingNumber: optionalTrimmed(60),
  trackingUrl: z
    .url("Enter a valid URL")
    .refine((u) => u.startsWith("https://") || u.startsWith("http://"), "Use an http(s) link")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  notes: optionalTrimmed(300),
  markShipped: z.boolean().default(true),
});

/** Manual shipment entry (courier integrations can later create these automatically). */
export async function addShipment(
  orderId: string,
  input: z.infer<typeof shipmentSchema>,
  actor: AdminActor,
) {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found");
  const shippable: OrderStatus[] = [...BEFORE_HANDOVER, "SHIPPED", "OUT_FOR_DELIVERY"];
  if (!shippable.includes(order.status)) {
    throw new AppError("INVALID_STATE", "Shipments can only be added to confirmed orders");
  }
  const alreadyShipped = order.status === "SHIPPED" || order.status === "OUT_FOR_DELIVERY";
  const shouldShip = input.markShipped && !alreadyShipped;
  await db.$transaction(async (tx) => {
    await tx.shipment.create({
      data: {
        orderId,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        trackingUrl: input.trackingUrl ?? null,
        notes: input.notes,
        status: shouldShip || alreadyShipped ? "SHIPPED" : "PENDING",
        shippedAt: shouldShip || alreadyShipped ? new Date() : null,
      },
    });
    if (shouldShip)
      await transitionOrder(tx, {
        orderId,
        to: "SHIPPED",
        actor: { type: "ADMIN", id: actor.id },
        note: `Shipped via ${input.carrier}`,
      });
    await audit(
      {
        actorId: actor.id,
        action: "order.shipment",
        entityType: "Order",
        entityId: orderId,
        metadata: { carrier: input.carrier, trackingNumber: input.trackingNumber ?? null },
        ipAddress: actor.ip,
      },
      tx,
    );
  });
}

export const refundSchema = z.object({
  amountPaise: z.coerce.number().int().positive("Amount must be positive"),
  reason: trimmed(3, 200, "Reason"),
});

export async function refundOrderAdmin(
  orderId: string,
  input: z.infer<typeof refundSchema>,
  actor: AdminActor,
) {
  const refund = await createRefund({
    orderId,
    amountPaise: input.amountPaise,
    reason: input.reason,
    actor: { type: "ADMIN", id: actor.id },
  });
  await audit({
    actorId: actor.id,
    action: "order.refund",
    entityType: "Order",
    entityId: orderId,
    metadata: {
      amountPaise: input.amountPaise,
      reason: input.reason,
      refundId: refund.id,
      status: refund.status,
    },
    ipAddress: actor.ip,
  });
  return refund;
}

export async function reconcileOrderAdmin(orderId: string, actor: AdminActor) {
  const result = await reconcileOrderPayments(orderId);
  await audit({
    actorId: actor.id,
    action: "order.reconcile",
    entityType: "Order",
    entityId: orderId,
    metadata: { result },
    ipAddress: actor.ip,
  });
  return result;
}

export async function resolveAttention(orderId: string, actor: AdminActor) {
  await db.order.update({ where: { id: orderId }, data: { requiresAttention: false } });
  await audit({
    actorId: actor.id,
    action: "order.attention_resolved",
    entityType: "Order",
    entityId: orderId,
    ipAddress: actor.ip,
  });
}
