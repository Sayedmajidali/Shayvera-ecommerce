import "server-only";
import { z } from "zod";
import { Prisma, type OrderRequest } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { divRound, formatINRExact } from "@/lib/money";
import { idSchema, optionalTrimmed, trimmed } from "@/lib/validation/common";
import { db, type Tx } from "@/server/platform/db";
import { audit } from "@/server/modules/audit/audit";
import { moveStock } from "@/server/modules/inventory/inventory";
import { queueOrderEmail } from "@/server/modules/notifications/notifications";
import { loadStoreSettings } from "@/server/modules/settings/queries";
import {
  cancelOrderAsCustomer,
  resolveOrderForRequester,
} from "@/server/modules/orders/order-actions";
import { AWAITING_PAYMENT, CANCELLATION_REQUESTABLE } from "@/server/modules/orders/order-status";
import { transitionOrder, type Actor } from "@/server/modules/orders/orders";
import { createRefund } from "@/server/modules/payments/payments";

/**
 * Customer cancellation and return requests (ARCHITECTURE.md §6, business rules):
 * - unpaid online order → the customer cancels immediately;
 * - accepted order not yet handed to the courier → the customer *requests* cancellation; staff approve
 *   (order cancelled, stock released or put back, full refund started for paid online orders) or reject
 *   (order returns to its previous status);
 * - delivered order within the return window → the customer *requests* a return for chosen lines;
 *   staff approve (customer told to send the goods back) or reject; when the goods arrive staff record
 *   what was received and how much to restock. Refunds for returns are a separate, explicit staff step.
 * Nothing is refunded or restocked without one of these explicit steps. One open request per order
 * (database partial unique index).
 */

type Who = { userId: string | null; token: string | null };
type StaffActor = { id: string; ip?: string | null };

export const cancellationRequestSchema = z.object({
  reason: optionalTrimmed(500),
  token: z.string().max(200).optional().nullable(),
});

export const returnRequestSchema = z.object({
  reason: trimmed(5, 500, "Reason"),
  lines: z
    .array(z.object({ orderItemId: idSchema, quantity: z.coerce.number().int().min(1).max(1000) }))
    .min(1, "Choose at least one item")
    .max(50),
  token: z.string().max(200).optional().nullable(),
});

export const resolveRequestSchema = z.object({ note: optionalTrimmed(500) });
export const rejectRequestSchema = z.object({ note: trimmed(5, 500, "Reason") });
export const receiveReturnSchema = z
  .object({
    lines: z
      .array(
        z.object({
          orderItemId: idSchema,
          receivedQuantity: z.coerce.number().int().min(0).max(1000),
          restockQuantity: z.coerce.number().int().min(0).max(1000),
        }),
      )
      .min(1)
      .max(50),
    note: optionalTrimmed(500),
  })
  .refine((v) => v.lines.every((l) => l.restockQuantity <= l.receivedQuantity), {
    message: "You can only restock items you received",
    path: ["lines"],
  });

type ReturnLine = { orderItemId: string; quantity: number };

function openRequestConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    throw new AppError("CONFLICT", "There is already an open request for this order");
  throw error;
}

// ───────────────────────────── Customer actions ─────────────────────────────

/** "Cancel" from the customer: immediate for unpaid orders, otherwise a request for staff. */
export async function customerCancel(orderNumber: string, who: Who, reason?: string | null) {
  const order = await resolveOrderForRequester(orderNumber, who);
  if (AWAITING_PAYMENT.includes(order.status)) {
    await cancelOrderAsCustomer(orderNumber, who, reason);
    return { outcome: "cancelled" as const };
  }
  if (!CANCELLATION_REQUESTABLE.includes(order.status))
    throw new AppError(
      "INVALID_STATE",
      order.status === "CANCELLATION_REQUESTED"
        ? "Your cancellation request is already being reviewed"
        : "This order has already left our warehouse. You can request a return after delivery.",
    );
  try {
    await db.$transaction(async (tx) => {
      await tx.orderRequest.create({
        data: {
          orderId: order.id,
          type: "CANCELLATION",
          reason: reason?.trim() || "No reason given",
          previousStatus: order.status,
          requestedById: who.userId,
        },
      });
      await transitionOrder(tx, {
        orderId: order.id,
        to: "CANCELLATION_REQUESTED",
        actor: { type: "CUSTOMER", id: who.userId },
        note: reason ? `Customer: ${reason.slice(0, 200)}` : "Customer asked to cancel",
      });
    });
  } catch (error) {
    openRequestConflict(error);
  }
  return { outcome: "requested" as const };
}

/** Return window: days after delivery, from Admin → Settings. */
export async function returnDeadline(deliveredAt: Date | null) {
  if (!deliveredAt) return null;
  const { returnWindowDays } = await loadStoreSettings();
  return new Date(deliveredAt.getTime() + returnWindowDays * 86_400_000);
}

export async function requestReturn(
  orderNumber: string,
  who: Who,
  input: { reason: string; lines: ReturnLine[] },
) {
  const order = await resolveOrderForRequester(orderNumber, who);
  if (order.status !== "DELIVERED")
    throw new AppError("INVALID_STATE", "Returns can be requested once the order is delivered");
  const deadline = await returnDeadline(order.deliveredAt);
  if (!deadline || deadline < new Date())
    throw new AppError(
      "BUSINESS_RULE",
      "The return window for this order has closed. Please contact support if something is wrong.",
    );
  const items = new Map(order.items.map((i) => [i.id, i]));
  const merged = new Map<string, number>();
  for (const l of input.lines) {
    const item = items.get(l.orderItemId);
    if (!item) throw new AppError("VALIDATION_ERROR", "One of the items is not part of this order");
    merged.set(l.orderItemId, (merged.get(l.orderItemId) ?? 0) + l.quantity);
    if (merged.get(l.orderItemId)! > item.quantity)
      throw new AppError(
        "VALIDATION_ERROR",
        `You can return at most ${item.quantity} × ${item.productName}`,
      );
  }
  const lines = [...merged].map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
  try {
    await db.$transaction(async (tx) => {
      await tx.orderRequest.create({
        data: {
          orderId: order.id,
          type: "RETURN",
          reason: input.reason,
          lines,
          previousStatus: order.status,
          requestedById: who.userId,
        },
      });
      await transitionOrder(tx, {
        orderId: order.id,
        to: "RETURN_REQUESTED",
        actor: { type: "CUSTOMER", id: who.userId },
        note: `Customer: ${input.reason.slice(0, 200)}`,
      });
    });
  } catch (error) {
    openRequestConflict(error);
  }
  return { outcome: "requested" as const };
}

/** The customer withdraws a request staff have not decided yet; the order goes back to where it was. */
export async function withdrawRequest(orderNumber: string, who: Who, requestId: string) {
  const order = await resolveOrderForRequester(orderNumber, who);
  await db.$transaction(async (tx) => {
    const req = await claim(tx, requestId, ["PENDING"], "WITHDRAWN", { orderId: order.id });
    await transitionOrder(tx, {
      orderId: order.id,
      to: req.previousStatus,
      actor: { type: "CUSTOMER", id: who.userId },
      note: "Customer withdrew the request",
    });
  });
}

// ───────────────────────────── Staff actions ─────────────────────────────

/** Moves a request from one of `from` to `to` exactly once (compare-and-set), returning it. */
async function claim(
  tx: Tx,
  id: string,
  from: OrderRequest["status"][],
  to: OrderRequest["status"],
  extra: { orderId?: string; data?: Prisma.OrderRequestUpdateManyMutationInput } = {},
) {
  const res = await tx.orderRequest.updateMany({
    where: { id, status: { in: from }, ...(extra.orderId ? { orderId: extra.orderId } : {}) },
    data: { status: to, ...extra.data },
  });
  if (res.count === 0) {
    const exists = await tx.orderRequest.findUnique({ where: { id } });
    throw exists && (!extra.orderId || exists.orderId === extra.orderId)
      ? new AppError("CONFLICT", "This request has already been handled")
      : new AppError("NOT_FOUND", "Request not found");
  }
  return tx.orderRequest.findUniqueOrThrow({ where: { id } });
}

export async function approveRequest(
  id: string,
  note: string | null | undefined,
  staff: StaffActor,
) {
  const actor: Actor = { type: "ADMIN", id: staff.id };
  const resolved = { resolutionNote: note ?? null, resolvedById: staff.id, resolvedAt: new Date() };
  const req = await db.orderRequest.findUnique({ where: { id } });
  if (!req) throw new AppError("NOT_FOUND", "Request not found");

  if (req.type === "RETURN") {
    await db.$transaction(async (tx) => {
      await claim(tx, id, ["PENDING"], "APPROVED", { data: resolved });
      await queueOrderEmail(tx, {
        orderId: req.orderId,
        kind: "return_approved",
        extra: note ?? null,
        dedupeKey: id,
      });
      await audit(
        {
          actorId: staff.id,
          action: "order.return.approve",
          entityType: "Order",
          entityId: req.orderId,
          metadata: { requestId: id },
          ipAddress: staff.ip,
        },
        tx,
      );
    });
    return {
      requestId: id,
      outcome: "approved" as const,
      refundStarted: false,
      shipmentToCancel: false,
    };
  }

  // Cancellation: cancel the order (stock released / put back) and refund paid online orders in full.
  await db.$transaction(async (tx) => {
    await claim(tx, id, ["PENDING"], "COMPLETED", { data: resolved });
    await transitionOrder(tx, {
      orderId: req.orderId,
      to: "CANCELLED",
      actor,
      note: `Cancellation approved${note ? `: ${note}` : ""}`,
    });
    await audit(
      {
        actorId: staff.id,
        action: "order.cancellation.approve",
        entityType: "Order",
        entityId: req.orderId,
        metadata: { requestId: id },
        ipAddress: staff.ip,
      },
      tx,
    );
  });
  const order = await db.order.findUniqueOrThrow({
    where: { id: req.orderId },
    include: { shipments: true },
  });
  let refundStarted = false;
  if (order.paymentMethod === "RAZORPAY" && order.paymentStatus === "PAID") {
    await createRefund({
      orderId: order.id,
      amountPaise: order.totalPaise - order.refundedPaise,
      reason: "Cancellation approved",
      actor,
    });
    refundStarted = true;
  }
  return {
    requestId: id,
    outcome: "cancelled" as const,
    refundStarted,
    // Courier bookings are cancelled automatically (shipping.cancel job); a manual shipment
    // record has to be cancelled with the courier by staff.
    shipmentToCancel: order.shipments.some(
      (s) => s.provider === "manual" && !["CANCELLED", "FAILED"].includes(s.status),
    ),
  };
}

export async function rejectRequest(id: string, note: string, staff: StaffActor) {
  const req = await db.orderRequest.findUnique({ where: { id } });
  if (!req) throw new AppError("NOT_FOUND", "Request not found");
  await db.$transaction(async (tx) => {
    // An approved return can still be rejected (e.g. goods never sent back).
    await claim(tx, id, req.type === "RETURN" ? ["PENDING", "APPROVED"] : ["PENDING"], "REJECTED", {
      data: { resolutionNote: note, resolvedById: staff.id, resolvedAt: new Date() },
    });
    await transitionOrder(tx, {
      orderId: req.orderId,
      to: req.type === "RETURN" ? "DELIVERED" : req.previousStatus,
      actor: { type: "ADMIN", id: staff.id },
      note: `${req.type === "RETURN" ? "Return" : "Cancellation"} request rejected: ${note}`,
    });
    await queueOrderEmail(tx, {
      orderId: req.orderId,
      kind: "request_rejected",
      extra: note,
      dedupeKey: id,
    });
    await audit(
      {
        actorId: staff.id,
        action: `order.${req.type.toLowerCase()}.reject`,
        entityType: "Order",
        entityId: req.orderId,
        metadata: { requestId: id, note },
        ipAddress: staff.ip,
      },
      tx,
    );
  });
}

/**
 * Staff record the returned goods: what arrived and how much goes back into sellable stock (food that
 * cannot be resold is received but not restocked). The order becomes RETURNED; refunds are separate.
 */
export async function receiveReturn(
  id: string,
  input: z.infer<typeof receiveReturnSchema>,
  staff: StaffActor,
) {
  const data = receiveReturnSchema.parse(input);
  await db.$transaction(async (tx) => {
    const req = await tx.orderRequest.findUnique({
      where: { id },
      include: { order: { include: { items: true } } },
    });
    if (!req || req.type !== "RETURN") throw new AppError("NOT_FOUND", "Return request not found");
    const requested = new Map((req.lines as ReturnLine[]).map((l) => [l.orderItemId, l.quantity]));
    const items = new Map(req.order.items.map((i) => [i.id, i]));
    for (const l of data.lines) {
      const max = requested.get(l.orderItemId);
      if (max === undefined)
        throw new AppError("VALIDATION_ERROR", "That item is not part of this return");
      if (l.receivedQuantity > max)
        throw new AppError(
          "VALIDATION_ERROR",
          `At most ${max} × ${items.get(l.orderItemId)?.productName} was requested`,
        );
    }
    await claim(tx, id, ["APPROVED"], "COMPLETED", {
      data: {
        receipt: data.lines,
        resolutionNote: data.note ?? req.resolutionNote,
        resolvedById: staff.id,
        resolvedAt: new Date(),
      },
    });
    for (const l of data.lines) {
      const item = items.get(l.orderItemId)!;
      if (l.restockQuantity > 0 && item.variantId) {
        await moveStock(tx, {
          variantId: item.variantId,
          delta: l.restockQuantity,
          reason: "RETURN",
          orderId: req.orderId,
          actorId: staff.id,
          note: `Return received for ${req.order.orderNumber}`,
        });
      }
    }
    await transitionOrder(tx, {
      orderId: req.orderId,
      to: "RETURNED",
      actor: { type: "ADMIN", id: staff.id },
      note: data.note ?? "Returned items received",
    });
    await audit(
      {
        actorId: staff.id,
        action: "order.return.receive",
        entityType: "Order",
        entityId: req.orderId,
        metadata: { requestId: id, lines: data.lines },
        ipAddress: staff.ip,
      },
      tx,
    );
  });
}

// ───────────────────────────── Queries ─────────────────────────────

export const requestListSchema = z.object({
  status: z
    .enum(["PENDING", "APPROVED", "REJECTED", "COMPLETED", "WITHDRAWN"])
    .optional()
    .catch(undefined),
  type: z.enum(["CANCELLATION", "RETURN"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

export async function listRequests(f: z.infer<typeof requestListSchema>, pageSize = 20) {
  const where: Prisma.OrderRequestWhereInput = {
    ...(f.status ? { status: f.status } : { status: { in: ["PENDING", "APPROVED"] } }),
    ...(f.type ? { type: f.type } : {}),
  };
  const [total, requests] = await Promise.all([
    db.orderRequest.count({ where }),
    db.orderRequest.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (f.page - 1) * pageSize,
      take: pageSize,
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            totalPaise: true,
            paymentMethod: true,
            paymentStatus: true,
            email: true,
          },
        },
      },
    }),
  ]);
  return { total, requests, page: f.page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Figures for Admin → Cancellations & returns (last 30 days unless stated). */
export async function requestStats() {
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const [open, awaitingReceipt, decided, refunds] = await Promise.all([
    db.orderRequest.groupBy({ by: ["type"], where: { status: "PENDING" }, _count: { _all: true } }),
    db.orderRequest.count({ where: { type: "RETURN", status: "APPROVED" } }),
    db.orderRequest.findMany({
      where: {
        resolvedAt: { gte: monthAgo },
        status: { in: ["APPROVED", "REJECTED", "COMPLETED"] },
      },
      select: { status: true, createdAt: true, resolvedAt: true },
    }),
    db.refund.aggregate({
      where: { status: "PROCESSED", processedAt: { gte: monthAgo } },
      _count: true,
      _sum: { amountPaise: true },
    }),
  ]);
  const openBy = Object.fromEntries(open.map((o) => [o.type, o._count._all]));
  const rejected = decided.filter((d) => d.status === "REJECTED").length;
  const hours = decided
    .filter((d) => d.resolvedAt)
    .map((d) => (d.resolvedAt!.getTime() - d.createdAt.getTime()) / 3_600_000)
    .sort((a, b) => a - b);
  return {
    openCancellations: openBy.CANCELLATION ?? 0,
    openReturns: openBy.RETURN ?? 0,
    awaitingReceipt,
    decided30d: decided.length,
    rejected30d: rejected,
    /** Median hours from request to decision over the last 30 days (null with no decisions). */
    medianDecisionHours: hours.length
      ? Math.round(hours[Math.floor(hours.length / 2)]! * 10) / 10
      : null,
    refunds30d: { count: refunds._count, paise: refunds._sum.amountPaise ?? 0 },
  };
}

// ───────────────────────────── Return refunds ─────────────────────────────

type ReceiptLine = { orderItemId: string; receivedQuantity: number; restockQuantity: number };

/**
 * What a received return is worth: each received unit at its paid price (line total incl. tax and
 * after discounts, pro-rated per unit). Shipping and COD fees are offered separately — the store
 * decides whether to refund them. Staff may refund less (e.g. a deduction after inspection), never more.
 */
export async function returnRefundQuote(requestId: string) {
  const req = await db.orderRequest.findUnique({
    where: { id: requestId },
    include: {
      order: { include: { items: true } },
      refunds: { select: { id: true, status: true, amountPaise: true, createdAt: true } },
    },
  });
  if (!req || req.type !== "RETURN") throw new AppError("NOT_FOUND", "Return request not found");
  const receipt = (req.receipt as ReceiptLine[] | null) ?? [];
  const items = receipt
    .filter((r) => r.receivedQuantity > 0)
    .map((r) => {
      const i = req.order.items.find((x) => x.id === r.orderItemId);
      if (!i) return null;
      return {
        orderItemId: i.id,
        name: `${i.productName} (${i.variantName})`,
        quantity: r.receivedQuantity,
        valuePaise: divRound(i.lineTotalPaise * r.receivedQuantity, i.quantity),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const itemsPaise = items.reduce((t, i) => t + i.valuePaise, 0);
  const remaining = req.order.totalPaise - req.order.refundedPaise;
  const live = req.refunds.find((r) => r.status !== "FAILED") ?? null;
  return {
    requestId: req.id,
    orderId: req.orderId,
    status: req.status,
    items,
    itemsPaise,
    shippingPaise: req.order.shippingPaise + req.order.codFeePaise,
    remainingPaise: remaining,
    paid: req.order.paymentStatus === "PAID" || req.order.paymentStatus === "PARTIALLY_REFUNDED",
    refund: live,
  };
}

export const refundReturnSchema = z.object({
  amountPaise: z.coerce.number().int().positive("Enter an amount"),
  includeShipping: z.boolean().default(false),
  note: optionalTrimmed(300),
});

/** Refunds a received return (once per request; linked to it, with a credit note if invoiced). */
export async function refundReturn(
  requestId: string,
  input: z.infer<typeof refundReturnSchema>,
  staff: StaffActor,
) {
  const data = refundReturnSchema.parse(input);
  const q = await returnRefundQuote(requestId);
  if (q.status !== "COMPLETED")
    throw new AppError("INVALID_STATE", "Mark the returned items as received first");
  if (!q.paid) throw new AppError("INVALID_STATE", "This order has no payment to refund");
  if (q.refund) throw new AppError("CONFLICT", "This return has already been refunded");
  const max = Math.min(
    q.itemsPaise + (data.includeShipping ? q.shippingPaise : 0),
    q.remainingPaise,
  );
  if (data.amountPaise > max)
    throw new AppError(
      "VALIDATION_ERROR",
      `At most ${formatINRExact(max)} can be refunded for this return`,
      { amountPaise: "Amount is more than the returned items are worth" },
    );
  const order = await db.order.findUniqueOrThrow({
    where: { id: q.orderId },
    select: { orderNumber: true },
  });
  const refund = await createRefund({
    orderId: q.orderId,
    amountPaise: data.amountPaise,
    reason:
      `Return ${order.orderNumber}: ${q.items.map((i) => `${i.name} × ${i.quantity}`).join(", ")}${data.note ? ` — ${data.note}` : ""}`.slice(
        0,
        500,
      ),
    actor: { type: "ADMIN", id: staff.id },
    requestId,
  });
  await audit({
    actorId: staff.id,
    action: "order.return.refund",
    entityType: "Order",
    entityId: q.orderId,
    metadata: { requestId, refundId: refund.id, amountPaise: data.amountPaise },
    ipAddress: staff.ip,
  });
  return refund;
}
