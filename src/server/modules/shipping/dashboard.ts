import "server-only";
import { z } from "zod";
import type { Prisma, ShipmentStatus } from "@prisma/client";
import { db } from "@/server/platform/db";

const STATUSES = [
  "PENDING",
  "CREATING",
  "CREATED",
  "AWB_ASSIGNED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "SHIPPED",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "UNDELIVERED",
  "RTO_INITIATED",
  "RTO_DELIVERED",
  "RETURNED",
  "CANCELLED",
  "LOST",
  "DAMAGED",
  "FAILED",
] as const satisfies readonly ShipmentStatus[];

export const shipmentListSchema = z.object({
  status: z.enum(STATUSES).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
});

const orderRef = { select: { id: true, orderNumber: true } } as const;

/** Figures and work queues for Admin → Shipments. Read-only. */
export async function getShipmentsDashboard(f: z.infer<typeof shipmentListSchema>) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const where: Prisma.ShipmentWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.q
      ? {
          OR: [
            { trackingNumber: { contains: f.q } },
            { reference: { contains: f.q, mode: "insensitive" } },
            { order: { orderNumber: { contains: f.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [
    toBook,
    awaitingPickup,
    inTransit,
    delivered7d,
    attention,
    unmatched,
    shipments,
    byStatus,
    returns,
  ] = await Promise.all([
    db.order.count({
      where: {
        status: { in: ["CONFIRMED", "PROCESSING"] },
        shipments: { none: { isReturn: false, status: { notIn: ["CANCELLED", "FAILED"] } } },
      },
    }),
    db.shipment.count({ where: { status: { in: ["AWB_ASSIGNED", "PICKUP_SCHEDULED"] } } }),
    db.shipment.count({
      where: { status: { in: ["PICKED_UP", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY"] } },
    }),
    db.shipment.count({ where: { status: "DELIVERED", updatedAt: { gte: weekAgo } } }),
    db.shipment.findMany({
      where: {
        OR: [
          { needsAttention: true },
          {
            status: "FAILED",
            order: { status: { notIn: ["CANCELLED", "RETURNED", "REFUNDED"] } },
          },
        ],
      },
      include: { order: orderRef },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    db.webhookEvent.findMany({
      where: {
        OR: [{ note: { not: null } }, { processingError: { not: null } }],
        receivedAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
      },
      orderBy: { receivedAt: "desc" },
      take: 20,
    }),
    db.shipment.findMany({
      where,
      include: { order: orderRef },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.shipment.groupBy({ by: ["status"], where: { isReturn: false }, _count: { _all: true } }),
    db.shipment.count({
      where: { isReturn: true, status: { notIn: ["CANCELLED", "FAILED", "DELIVERED"] } },
    }),
  ]);
  const c = Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])) as Partial<
    Record<ShipmentStatus, number>
  >;
  const sum = (...k: ShipmentStatus[]) => k.reduce((t, s) => t + (c[s] ?? 0), 0);
  return {
    tiles: { toBook, awaitingPickup, inTransit, delivered7d, attention: attention.length },
    /** Delivery shipments by stage (all time, excluding return pickups) plus open return pickups. */
    groups: [
      { label: "Booking", statuses: "PENDING", count: sum("PENDING", "CREATING", "CREATED") },
      { label: "Booking failed", statuses: "FAILED", count: sum("FAILED") },
      { label: "AWB assigned", statuses: "AWB_ASSIGNED", count: sum("AWB_ASSIGNED") },
      { label: "Pickup scheduled", statuses: "PICKUP_SCHEDULED", count: sum("PICKUP_SCHEDULED") },
      {
        label: "In transit",
        statuses: "IN_TRANSIT",
        count: sum("PICKED_UP", "SHIPPED", "IN_TRANSIT"),
      },
      { label: "Out for delivery", statuses: "OUT_FOR_DELIVERY", count: sum("OUT_FOR_DELIVERY") },
      { label: "Delivery failed", statuses: "UNDELIVERED", count: sum("UNDELIVERED") },
      { label: "Delivered", statuses: "DELIVERED", count: sum("DELIVERED") },
      { label: "RTO in progress", statuses: "RTO_INITIATED", count: sum("RTO_INITIATED") },
      {
        label: "RTO delivered",
        statuses: "RTO_DELIVERED",
        count: sum("RTO_DELIVERED", "RETURNED"),
      },
      { label: "Lost / damaged", statuses: "LOST", count: sum("LOST", "DAMAGED") },
    ],
    openReturnPickups: returns,
    attention,
    unmatched: unmatched.map((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      return {
        id: e.id,
        receivedAt: e.receivedAt,
        awb: typeof p.awb === "string" || typeof p.awb === "number" ? String(p.awb) : null,
        status: typeof p.current_status === "string" ? p.current_status : null,
        note: e.note ?? e.processingError,
      };
    }),
    shipments,
  };
}
