import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Prisma, type Shipment, type ShipmentStatus } from "@prisma/client";
import { queueStaffAlert } from "@/server/modules/notifications/staff-alerts";
import { AppError } from "@/lib/errors";
import { stateName } from "@/lib/india";
import {
  indianPhoneSchema,
  emailSchema,
  pincodeSchema,
  stateCodeSchema,
  trimmed,
  optionalTrimmed,
} from "@/lib/validation/common";
import { db, type Tx } from "@/server/platform/db";
import { HttpError } from "@/server/platform/http";
import { enqueue, retryJob } from "@/server/platform/jobs/queue";
import type { JobContext } from "@/server/platform/jobs/runner";
import { logger } from "@/server/platform/logger";
import { captureIntegrationFailure } from "@/server/platform/monitoring";
import { audit } from "@/server/modules/audit/audit";
import { transitionOrder } from "@/server/modules/orders/orders";
import { canTransition } from "@/server/modules/orders/order-status";
import type { AddressSnapshot } from "@/lib/validation/checkout";
import { shippingProviderName } from "@/lib/env";
import { packageForItems } from "./serviceability";
import { shippingProvider } from "./provider";
import { ShiprocketRejected, parseIstDateTime } from "./providers/shiprocket/shipments";
import {
  ACTIVE_SHIPMENT,
  CANCELLABLE_SHIPMENT,
  needsAttentionCode,
  normalizeShiprocketStatus,
  ORDER_STATUS_FOR_SHIPMENT,
  TERMINAL_SHIPMENT,
} from "./status";
import type { ProviderEvent, ProviderShipmentRef, ShipmentOperations } from "./types";

/**
 * Shipment lifecycle with a courier aggregator (SHIPPING_INTEGRATION.md). The shipment row is created
 * first with a unique reference; booking runs as a job. A booking whose outcome is unknown (timeout,
 * 5xx) is never repeated blindly: the next attempt looks the reference up at the provider first, and
 * the provider's duplicate-reference error (422) is treated as "already exists".
 */

declare module "@/server/platform/jobs/queue" {
  interface JobPayloads {
    "shipping.create": { shipmentId: string };
    "shipping.cancel": { shipmentId: string; reason: string };
    "shipping.webhook": { webhookEventId: string };
    "shipping.sync-tracking": Record<string, never>;
  }
}

type Staff = { id: string; ip?: string | null };

function ops(): ShipmentOperations {
  const p = shippingProvider();
  if (!p.shipments)
    throw new AppError(
      "BUSINESS_RULE",
      "Shipping is set to manual: add the courier and tracking number yourself",
    );
  return p.shipments;
}

/** Definitive = the provider answered and refused (fix the data, then retry); otherwise unknown. */
function isDefinitive(error: unknown) {
  if (error instanceof ShiprocketRejected) return true;
  if (error instanceof HttpError)
    return (
      error.status !== null &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408 &&
      error.status !== 429
    );
  return false;
}

function errorText(error: unknown) {
  if (error instanceof HttpError) {
    const b = error.body as { message?: unknown; errors?: unknown } | null;
    const detail = b && typeof b === "object" ? (b.message ?? b.errors) : null;
    return `${error.message}${detail ? `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`.slice(
      0,
      480,
    );
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, 480);
}

// ───────────────────────────── Pickup location ─────────────────────────────

export const pickupLocationSchema = z.object({
  name: trimmed(2, 60, "Pickup location name"),
  contactName: trimmed(2, 80, "Contact name"),
  phone: indianPhoneSchema,
  email: emailSchema,
  line1: trimmed(3, 200, "Address"),
  line2: optionalTrimmed(200),
  city: trimmed(2, 80, "City"),
  stateCode: stateCodeSchema,
  pincode: pincodeSchema,
});

export function getDefaultPickupLocation(client: Tx | typeof db = db) {
  return client.pickupLocation.findFirst({ where: { isDefault: true } });
}

/** Saves the default pickup location (single warehouse) and keeps the store PIN in sync for checkout checks. */
export async function saveDefaultPickupLocation(
  input: z.infer<typeof pickupLocationSchema>,
  staff: Staff,
) {
  const data = pickupLocationSchema.parse(input);
  return db.$transaction(async (tx) => {
    const current = await getDefaultPickupLocation(tx);
    const saved = current
      ? await tx.pickupLocation.update({ where: { id: current.id }, data })
      : await tx.pickupLocation.create({ data: { ...data, isDefault: true } });
    await tx.storeSettings.updateMany({
      where: { id: "default" },
      data: { pincode: data.pincode },
    });
    await audit(
      {
        actorId: staff.id,
        action: "shipping.pickup_location",
        entityType: "PickupLocation",
        entityId: saved.id,
        ipAddress: staff.ip,
      },
      tx,
    );
    return saved;
  });
}

// ───────────────────────────── Booking ─────────────────────────────

export const createShipmentSchema = z.object({
  courierId: z.string().trim().max(30).optional().nullable(),
  weightGrams: z.coerce.number().int().min(1).max(100_000).optional(),
  lengthMm: z.coerce.number().int().min(1).max(2000).optional(),
  breadthMm: z.coerce.number().int().min(1).max(2000).optional(),
  heightMm: z.coerce.number().int().min(1).max(2000).optional(),
});

const BOOKABLE = ["CONFIRMED", "PROCESSING", "READY_TO_SHIP"] as const;

/** Staff "Create shipment": records the parcel and queues the booking. One active shipment per order. */
export async function requestShipment(
  orderId: string,
  input: z.infer<typeof createShipmentSchema>,
  staff: Staff,
) {
  const data = createShipmentSchema.parse(input);
  ops();
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found");
  if (!(BOOKABLE as readonly string[]).includes(order.status))
    throw new AppError(
      "INVALID_STATE",
      "Shipments can be booked for confirmed orders that have not shipped yet",
    );
  const pickup = await getDefaultPickupLocation();
  if (!pickup)
    throw new AppError("BUSINESS_RULE", "Add your pickup location in Admin → Settings first");
  const estimate = await packageForItems(
    order.items
      .filter((i) => i.variantId)
      .map((i) => ({
        variantId: i.variantId!,
        quantity: i.quantity,
        unitPricePaise: i.unitPricePaise,
      })),
  );
  const parcel = {
    weightGrams: data.weightGrams ?? estimate.parcel.weightGrams,
    lengthMm: data.lengthMm ?? estimate.parcel.lengthMm,
    breadthMm: data.breadthMm ?? estimate.parcel.breadthMm,
    heightMm: data.heightMm ?? estimate.parcel.heightMm,
  };
  try {
    return await db.$transaction(async (tx) => {
      const n = (await tx.shipment.count({ where: { orderId, isReturn: false } })) + 1;
      const shipment = await tx.shipment.create({
        data: {
          orderId,
          provider: shippingProvider().name,
          reference: `${order.orderNumber}-${n}`,
          pickupLocationId: pickup.id,
          carrier: "Pending courier",
          courierId: data.courierId ?? null,
          status: "PENDING",
          ...parcel,
          codAmountPaise: order.paymentMethod === "COD" ? order.totalPaise : null,
        },
      });
      await enqueue(
        "shipping.create",
        { shipmentId: shipment.id },
        { tx, dedupeKey: `ship-create:${shipment.id}` },
      );
      await audit(
        {
          actorId: staff.id,
          action: "shipping.create",
          entityType: "Order",
          entityId: orderId,
          metadata: { shipmentId: shipment.id, ...parcel },
          ipAddress: staff.ip,
        },
        tx,
      );
      return shipment;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new AppError("CONFLICT", "This order already has an active shipment");
    throw error;
  }
}

/** Job: books the parcel with the provider and assigns an AWB. Safe to run again after any failure. */
export async function processShipmentCreation(shipmentId: string, ctx?: JobContext) {
  const claimed = await db.shipment.updateMany({
    where: { id: shipmentId, status: { in: ["PENDING", "CREATING", "CREATED"] } },
    data: { status: "CREATING", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return;
  const s = await db.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    include: { order: { include: { items: true } }, pickupLocation: true },
  });
  const provider = ops();
  try {
    let ref: ProviderShipmentRef | null = s.providerShipmentId
      ? {
          providerOrderId: s.providerOrderId!,
          providerShipmentId: s.providerShipmentId,
          awb: s.trackingNumber,
        }
      : null;
    // A previous attempt may have created it without us hearing back: look before creating.
    if (!ref && s.attempts > 1) ref = await provider.findShipmentByReference(s.reference!);
    if (!ref) {
      try {
        ref = await provider.createShipment(bookingInput(s));
      } catch (error) {
        if (error instanceof HttpError && error.status === 422) {
          ref = await provider.findShipmentByReference(s.reference!);
          if (!ref) throw error;
        } else throw error;
      }
      await db.shipment.update({
        where: { id: s.id },
        data: {
          providerOrderId: ref.providerOrderId,
          providerShipmentId: ref.providerShipmentId,
          status: "CREATING",
        },
      });
    }
    let awb = ref.awb ?? null;
    let courier = {
      courierId: s.courierId,
      courierName: s.carrier,
      pickupScheduledAt: null as Date | null,
    };
    if (!awb) {
      const a = await provider.assignAwb({
        providerShipmentId: ref.providerShipmentId,
        courierId: s.courierId,
      });
      awb = a.awb;
      courier = {
        courierId: a.courierId,
        courierName: a.courierName,
        pickupScheduledAt: a.pickupScheduledAt,
      };
    }
    await db.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: s.id },
        data: {
          status: "AWB_ASSIGNED",
          trackingNumber: awb,
          trackingUrl: provider.trackingUrl(awb!),
          carrier: courier.courierName,
          courierId: courier.courierId,
          pickupScheduledAt: courier.pickupScheduledAt,
          lastError: null,
        },
      });
      await recordEvent(tx, s.id, {
        status: "AWB_ASSIGNED",
        activity: `AWB ${awb} assigned (${courier.courierName})`,
        occurredAt: new Date(),
        source: "SYSTEM",
      });
      await advanceOrder(tx, s.orderId, "AWB_ASSIGNED");
    });
    // Best effort: the label can also be generated later from the admin.
    try {
      const { labelUrl } = await provider.generateLabel(ref.providerShipmentId);
      await db.shipment.update({ where: { id: s.id }, data: { labelUrl } });
    } catch (error) {
      logger.warn("Label generation failed; can be retried from the admin", {
        shipmentId: s.id,
        error,
      });
    }
  } catch (error) {
    const definitive = isDefinitive(error);
    await db.shipment.update({
      where: { id: s.id },
      data: {
        lastError: errorText(error),
        // Definitive refusals need a human; unknown outcomes stay CREATING and the job retries.
        ...(definitive || ctx?.isLastAttempt ? { status: "FAILED", needsAttention: true } : {}),
      },
    });
    captureIntegrationFailure(shippingProvider().name, "create-shipment", error, {
      shipmentId: s.id,
      definitive,
    });
    if (definitive || ctx?.isLastAttempt)
      await db.$transaction((tx) =>
        queueStaffAlert(tx, {
          kind: "shipment_problem",
          orderId: s.orderId,
          dedupeKey: `${s.id}:booking-failed:${s.attempts}`,
          extra: `Courier booking failed: ${errorText(error).slice(0, 150)}`,
        }),
      );
    if (!definitive) throw error;
  }
}

function bookingInput(
  s: Shipment & {
    order: Prisma.OrderGetPayload<{ include: { items: true } }>;
    pickupLocation: { name: string } | null;
  },
) {
  const a = s.order.shippingAddress as AddressSnapshot;
  return {
    reference: s.reference!,
    orderDate: s.order.placedAt,
    pickupLocationName: s.pickupLocation?.name ?? "Primary",
    customer: {
      name: a.fullName,
      phone: a.phone,
      email: s.order.email,
      line1: [a.line1, a.line2].filter(Boolean).join(", "),
      line2: a.landmark ? `Near ${a.landmark}` : null,
      city: a.city,
      state: stateName(a.stateCode),
      pincode: a.pincode,
    },
    items: s.order.items.map((i) => ({
      name: `${i.productName} (${i.variantName})`.slice(0, 100),
      sku: i.sku,
      units: i.quantity,
      sellingPricePaise: i.unitPricePaise,
      hsn: i.hsnCode,
    })),
    paymentMethod: s.order.paymentMethod === "COD" ? ("COD" as const) : ("PREPAID" as const),
    subTotalPaise: s.order.totalPaise,
    weightGrams: s.weightGrams ?? 500,
    lengthMm: s.lengthMm ?? 200,
    breadthMm: s.breadthMm ?? 150,
    heightMm: s.heightMm ?? 100,
  };
}

/** Staff: retry a booking that failed (after fixing the data at the provider or in the order). */
export async function retryShipmentCreation(shipmentId: string, staff: Staff) {
  const res = await db.shipment.updateMany({
    where: { id: shipmentId, status: "FAILED", provider: { not: "manual" } },
    data: { status: "PENDING", needsAttention: false, lastError: null },
  });
  if (res.count === 0) throw new AppError("INVALID_STATE", "Only failed bookings can be retried");
  // The earlier job may have finished (a definite refusal ends it on purpose): queue a fresh one.
  const job = await db.job.findUnique({ where: { dedupeKey: `ship-create:${shipmentId}` } });
  if (!job || !(await retryJob(job.id)))
    await enqueue(
      "shipping.create",
      { shipmentId },
      { dedupeKey: `ship-create:${shipmentId}:${Date.now()}` },
    );
  await audit({
    actorId: staff.id,
    action: "shipping.retry",
    entityType: "Shipment",
    entityId: shipmentId,
    ipAddress: staff.ip,
  });
}

// ───────────────────────────── Pickup, label, manifest ─────────────────────────────

async function providerShipment(shipmentId: string) {
  const s = await db.shipment.findUnique({ where: { id: shipmentId } });
  if (!s || s.provider === "manual") throw new AppError("NOT_FOUND", "Shipment not found");
  if (!s.providerShipmentId || !s.trackingNumber)
    throw new AppError("INVALID_STATE", "The shipment has no AWB yet");
  return s;
}

async function callProvider<T>(fn: () => Promise<T>, operation: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    captureIntegrationFailure(shippingProvider().name, operation, error);
    if (error instanceof AppError) throw error;
    throw new AppError(
      isDefinitive(error) ? "BUSINESS_RULE" : "PAYMENT_ERROR",
      isDefinitive(error)
        ? `Courier: ${errorText(error)}`
        : "The courier service is unavailable. Please try again.",
    );
  }
}

export const pickupSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .nullable(),
});

export async function schedulePickup(
  shipmentId: string,
  date: string | null | undefined,
  staff: Staff,
) {
  const s = await providerShipment(shipmentId);
  if (!["AWB_ASSIGNED", "PICKUP_SCHEDULED"].includes(s.status))
    throw new AppError(
      "INVALID_STATE",
      "Pickup can be scheduled once the AWB is assigned and before pickup",
    );
  const p = ops();
  const r = await callProvider(
    () => p.schedulePickup({ providerShipmentId: s.providerShipmentId!, date }),
    "schedule-pickup",
  );
  let manifestUrl = s.manifestUrl;
  if (!manifestUrl) {
    // Shiprocket: generate the manifest after the pickup request succeeds (best effort).
    manifestUrl = await p.generateManifest(s.providerShipmentId!).then(
      (m) => m.manifestUrl,
      () => null,
    );
  }
  await db.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: s.id },
      data: {
        status: "PICKUP_SCHEDULED",
        pickupScheduledAt: r.pickupScheduledAt ?? s.pickupScheduledAt,
        manifestUrl,
      },
    });
    await recordEvent(tx, s.id, {
      status: "PICKUP_SCHEDULED",
      activity: "Pickup requested",
      occurredAt: new Date(),
      source: "ADMIN",
    });
    await audit(
      {
        actorId: staff.id,
        action: "shipping.pickup",
        entityType: "Shipment",
        entityId: s.id,
        metadata: { date: date ?? null },
        ipAddress: staff.ip,
      },
      tx,
    );
  });
}

export async function ensureDocument(shipmentId: string, kind: "label" | "manifest") {
  const s = await providerShipment(shipmentId);
  if (kind === "label" && s.labelUrl) return s.labelUrl;
  if (kind === "manifest" && s.manifestUrl) return s.manifestUrl;
  const p = ops();
  if (kind === "label") {
    const { labelUrl } = await callProvider(
      () => p.generateLabel(s.providerShipmentId!),
      "generate-label",
    );
    await db.shipment.update({ where: { id: s.id }, data: { labelUrl } });
    return labelUrl;
  }
  const { manifestUrl } = await callProvider(
    () => p.generateManifest(s.providerShipmentId!),
    "generate-manifest",
  );
  await db.shipment.update({ where: { id: s.id }, data: { manifestUrl } });
  return manifestUrl;
}

// ───────────────────────────── Cancellation ─────────────────────────────

/** Cancels a shipment that has not been handed to the courier. Staff action or order cancellation (job). */
export async function cancelShipment(shipmentId: string, reason: string, actor: Staff | null) {
  const s = await db.shipment.findUnique({ where: { id: shipmentId } });
  if (!s || s.provider === "manual") throw new AppError("NOT_FOUND", "Shipment not found");
  if (s.status === "CANCELLED") return;
  if (!CANCELLABLE_SHIPMENT.includes(s.status))
    throw new AppError(
      "INVALID_STATE",
      "The courier already has this parcel; it can no longer be cancelled",
    );
  if (s.providerOrderId || s.trackingNumber) {
    const p = ops();
    await callProvider(
      () => p.cancelShipment({ awb: s.trackingNumber, providerOrderId: s.providerOrderId }),
      "cancel-shipment",
    );
  }
  await db.$transaction(async (tx) => {
    const res = await tx.shipment.updateMany({
      where: { id: s.id, status: { notIn: ["CANCELLED"] } },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    if (res.count === 0) return;
    await recordEvent(tx, s.id, {
      status: "CANCELLED",
      activity: `Cancelled: ${reason}`.slice(0, 300),
      occurredAt: new Date(),
      source: actor ? "ADMIN" : "SYSTEM",
    });
    if (actor)
      await audit(
        {
          actorId: actor.id,
          action: "shipping.cancel",
          entityType: "Shipment",
          entityId: s.id,
          metadata: { reason },
          ipAddress: actor.ip,
        },
        tx,
      );
  });
}

/** Called inside an order-cancellation transaction: queue cancellation of its active provider shipments. */
export async function queueShipmentCancellationsForOrder(tx: Tx, orderId: string, reason: string) {
  const active = await tx.shipment.findMany({
    where: {
      orderId,
      provider: { not: "manual" },
      isReturn: false,
      status: { in: [...CANCELLABLE_SHIPMENT] },
    },
    select: { id: true },
  });
  for (const s of active)
    await enqueue(
      "shipping.cancel",
      { shipmentId: s.id, reason },
      { tx, dedupeKey: `ship-cancel:${s.id}` },
    );
  return active.length;
}

// ───────────────────────────── Tracking ─────────────────────────────

type EventInput = {
  status?: ShipmentStatus | null;
  providerStatus?: string | null;
  providerStatusCode?: number | null;
  activity?: string | null;
  location?: string | null;
  occurredAt: Date;
  source: "WEBHOOK" | "POLL" | "ADMIN" | "SYSTEM";
};

async function recordEvent(tx: Tx, shipmentId: string, e: EventInput) {
  const dedupeHash = createHash("sha256")
    .update(
      [
        shipmentId,
        e.occurredAt.toISOString(),
        e.providerStatusCode ?? e.status ?? "",
        e.activity ?? "",
      ].join("|"),
    )
    .digest("hex");
  await tx.shipmentEvent.createMany({
    data: [
      {
        shipmentId,
        status: e.status ?? null,
        providerStatus: e.providerStatus?.slice(0, 80) ?? null,
        providerStatusCode: e.providerStatusCode ?? null,
        activity: e.activity?.slice(0, 300) ?? null,
        location: e.location?.slice(0, 200) ?? null,
        occurredAt: e.occurredAt,
        source: e.source,
        dedupeHash,
      },
    ],
    skipDuplicates: true,
  });
}

/** Moves the order to the status implied by its delivery shipment, through SHIPPED if needed. */
async function advanceOrder(tx: Tx, orderId: string, shipmentStatus: ShipmentStatus) {
  const target = ORDER_STATUS_FOR_SHIPMENT[shipmentStatus];
  if (!target) return;
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status === target) return;
  const actor = { type: "SYSTEM" as const };
  const note = `Courier: ${shipmentStatus.replace(/_/g, " ").toLowerCase()}`;
  if (canTransition(order.status, target)) {
    await transitionOrder(tx, { orderId, to: target, actor, note });
    return;
  }
  // E.g. ready to ship → delivered when intermediate scans were missed.
  if (
    (target === "OUT_FOR_DELIVERY" || target === "DELIVERED" || target === "RETURNED") &&
    canTransition(order.status, "SHIPPED")
  ) {
    await transitionOrder(tx, { orderId, to: "SHIPPED", actor, note: "Courier: picked up" });
    if (canTransition("SHIPPED", target))
      await transitionOrder(tx, { orderId, to: target, actor, note });
    return;
  }
  if (order.status !== "CANCELLED" && order.status !== "REFUNDED")
    logger.info("Courier status does not imply an order change", {
      orderId,
      from: order.status,
      shipmentStatus,
    });
}

export type TrackingUpdate = {
  code: number | null;
  label: string | null;
  occurredAt: Date | null;
  etd?: Date | null;
  events?: ProviderEvent[];
};

/**
 * Applies a provider status to a shipment. History is always recorded; the current status changes
 * only for newer events, terminal states are never overwritten, unknown codes change nothing (flagged).
 */
export async function applyTrackingUpdate(
  shipmentId: string,
  u: TrackingUpdate,
  source: "WEBHOOK" | "POLL",
) {
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Shipment" WHERE id = ${shipmentId} FOR UPDATE`;
    if (!rows[0]) return;
    const s = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    for (const e of u.events ?? [])
      await recordEvent(tx, s.id, {
        status: normalizeShiprocketStatus(e.code),
        providerStatus: e.label,
        providerStatusCode: e.code,
        activity: e.activity,
        location: e.location,
        occurredAt: e.occurredAt,
        source,
      });
    const at = u.occurredAt ?? new Date();
    const status = normalizeShiprocketStatus(u.code);
    await recordEvent(tx, s.id, {
      status,
      providerStatus: u.label,
      providerStatusCode: u.code,
      activity: u.label,
      occurredAt: at,
      source,
    });

    const stale = s.lastEventAt !== null && at < s.lastEventAt;
    const terminalLock =
      TERMINAL_SHIPMENT.includes(s.status) && (!status || !TERMINAL_SHIPMENT.includes(status));
    if (!status) {
      await tx.shipment.update({
        where: { id: s.id },
        data: { needsAttention: true, providerStatus: u.label?.slice(0, 80) ?? s.providerStatus },
      });
      await queueStaffAlert(tx, {
        kind: "shipment_problem",
        orderId: s.orderId,
        dedupeKey: `${s.id}:code:${u.code}`,
        extra: `Unrecognised courier status ${u.code} (${u.label ?? "no label"})`,
      });
      logger.warn("Unknown courier status code", {
        shipmentId: s.id,
        code: u.code,
        label: u.label,
      });
      return;
    }
    if (stale || terminalLock || s.status === "CANCELLED") return;
    await tx.shipment.update({
      where: { id: s.id },
      data: {
        status,
        providerStatus: u.label?.slice(0, 80) ?? null,
        providerStatusCode: u.code,
        lastEventAt: at,
        etd: u.etd ?? s.etd,
        needsAttention:
          s.needsAttention ||
          needsAttentionCode(u.code) ||
          status === "LOST" ||
          status === "DAMAGED",
        ...((status === "PICKED_UP" || status === "IN_TRANSIT") && !s.shippedAt
          ? { shippedAt: at }
          : {}),
        ...(status === "DELIVERED" ? { deliveredAt: at } : {}),
      },
    });
    if (!s.isReturn) {
      await advanceOrder(tx, s.orderId, status);
      if (status === "LOST" || status === "DAMAGED" || status === "RTO_INITIATED")
        await queueStaffAlert(tx, {
          kind: "shipment_problem",
          orderId: s.orderId,
          dedupeKey: `${s.id}:${status}`,
          extra: `Courier reported: ${u.label ?? status}`,
        });
      if (status === "LOST" || status === "DAMAGED" || status === "RTO_INITIATED")
        await tx.order.update({
          where: { id: s.orderId },
          data: {
            requiresAttention: true,
            attentionReason: `Courier reported: ${u.label ?? status}`,
          },
        });
    }
  });
}

/** Scheduled: polls active provider shipments that have not had an update for 2 hours. */
export async function syncTracking(limit = 50) {
  if (!shippingProvider().shipments) return { checked: 0, updated: 0 };
  const stale = new Date(Date.now() - 2 * 3_600_000);
  const list = await db.shipment.findMany({
    where: {
      provider: shippingProvider().name,
      trackingNumber: { not: null },
      status: { in: [...ACTIVE_SHIPMENT] },
      OR: [{ lastEventAt: null }, { lastEventAt: { lt: stale } }],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  let updated = 0;
  for (const s of list) {
    try {
      const t = await ops().track(s.trackingNumber!);
      if (t.code !== null || t.events.length) {
        await applyTrackingUpdate(s.id, t, "POLL");
        updated++;
      }
    } catch (error) {
      logger.warn("Tracking poll failed", { shipmentId: s.id, error });
    }
  }
  return { checked: list.length, updated };
}

// ───────────────────────────── Courier webhooks ─────────────────────────────

/** Constant-time token check. In production a token is required (SHIPROCKET_WEBHOOK_TOKEN). */
export function courierWebhookAuthorized(apiKey: string | null) {
  const expected = process.env.SHIPROCKET_WEBHOOK_TOKEN ?? "";
  if (!expected) return process.env.NODE_ENV !== "production";
  if (!apiKey) return false;
  const a = Buffer.from(apiKey);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const webhookBody = z
  .object({
    awb: z.union([z.string(), z.number()]).transform(String),
    current_status: z.string().optional(),
    shipment_status: z.string().optional(),
    shipment_status_id: z.union([z.number(), z.string()]).optional(),
    current_status_id: z.union([z.number(), z.string()]).optional(),
    current_timestamp: z.string().optional(),
    etd: z.string().optional().nullable(),
    scans: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

/** Stores an authenticated courier webhook once and queues its processing (fast 200). */
/**
 * One stored event per courier scan: AWB + status id + the courier's own timestamp. A redelivery of
 * the same scan has the same key; without a timestamp the raw body decides.
 */
export function courierWebhookDedupeKey(
  p: {
    awb: string | number;
    shipment_status_id?: number | string | null;
    current_status_id?: number | string | null;
    current_timestamp?: string | null;
  },
  raw: string,
) {
  return createHash("sha256")
    .update(
      [p.awb, p.shipment_status_id ?? p.current_status_id ?? "", p.current_timestamp ?? raw].join(
        "|",
      ),
    )
    .digest("hex");
}

export async function receiveCourierWebhook(raw: string) {
  let parsed: z.infer<typeof webhookBody>;
  try {
    parsed = webhookBody.parse(JSON.parse(raw));
  } catch {
    throw new AppError("VALIDATION_ERROR", "Malformed courier webhook");
  }
  const dedupeKey = courierWebhookDedupeKey(parsed, raw);
  try {
    await db.$transaction(async (tx) => {
      const ev = await tx.webhookEvent.create({
        data: {
          provider: "shiprocket",
          dedupeKey,
          payload: parsed as unknown as Prisma.InputJsonValue,
        },
      });
      await enqueue(
        "shipping.webhook",
        { webhookEventId: ev.id },
        { tx, dedupeKey: `courier-event:${ev.id}`, priority: 5 },
      );
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return { duplicate: true };
    throw error;
  }
  return { duplicate: false };
}

/** Job: applies a stored courier webhook. */
export async function processCourierWebhook(webhookEventId: string) {
  const ev = await db.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!ev || ev.processedAt) return;
  const b = ev.payload as z.infer<typeof webhookBody>;
  try {
    const shipment = await db.shipment.findFirst({
      where: { trackingNumber: b.awb, provider: { not: "manual" } },
    });
    if (!shipment) {
      await db.webhookEvent.update({
        where: { id: ev.id },
        data: { processedAt: new Date(), note: "Unknown AWB" },
      });
      logger.warn("Courier webhook for an unknown AWB", { awb: b.awb });
      return;
    }
    const code = Number(b.shipment_status_id ?? NaN);
    const events: ProviderEvent[] = (b.scans ?? [])
      .map((sc) => {
        const c = Number(sc["sr-status"]);
        const label =
          typeof sc["sr-status-label"] === "string" && sc["sr-status-label"] !== "NA"
            ? (sc["sr-status-label"] as string)
            : null;
        return {
          code: Number.isFinite(c) && c > 0 ? c : null,
          label,
          activity: typeof sc.activity === "string" ? sc.activity : null,
          location: typeof sc.location === "string" ? sc.location : null,
          occurredAt: parseIstDateTime(sc.date) ?? new Date(0),
        };
      })
      .filter((e) => e.occurredAt.getTime() > 0);
    await applyTrackingUpdate(
      shipment.id,
      {
        code: Number.isFinite(code) ? code : null,
        label: b.shipment_status ?? b.current_status ?? null,
        occurredAt: parseIstDateTime(b.current_timestamp) ?? new Date(),
        etd: parseIstDateTime(b.etd),
        events,
      },
      "WEBHOOK",
    );
    await db.webhookEvent.update({
      where: { id: ev.id },
      data: { processedAt: new Date(), processingError: null },
    });
  } catch (error) {
    await db.webhookEvent.update({
      where: { id: ev.id },
      data: { processingError: errorText(error) },
    });
    throw error;
  }
}

// ───────────────────────────── Returns ─────────────────────────────

/** Books a return pickup from the customer for an approved return request. */
export async function requestReturnPickup(requestId: string, staff: Staff) {
  const req = await db.orderRequest.findUnique({
    where: { id: requestId },
    include: { order: { include: { items: true } } },
  });
  if (!req || req.type !== "RETURN") throw new AppError("NOT_FOUND", "Return request not found");
  if (req.status !== "APPROVED") throw new AppError("INVALID_STATE", "Approve the return first");
  const pickup = await getDefaultPickupLocation();
  if (!pickup)
    throw new AppError("BUSINESS_RULE", "Add your pickup location in Admin → Settings first");
  const existing = await db.shipment.findFirst({
    where: { orderId: req.orderId, isReturn: true, status: { notIn: ["CANCELLED", "FAILED"] } },
  });
  if (existing) throw new AppError("CONFLICT", "A return pickup is already booked");
  const p = ops();
  const lines = (req.lines as { orderItemId: string; quantity: number }[]) ?? [];
  const items = lines
    .map((l) => ({ l, item: req.order.items.find((i) => i.id === l.orderItemId)! }))
    .filter((x) => x.item);
  const a = req.order.shippingAddress as AddressSnapshot;
  const n = (await db.shipment.count({ where: { orderId: req.orderId, isReturn: true } })) + 1;
  const reference = `${req.order.orderNumber}-R${n}`;
  const {
    parcel: { weightGrams, lengthMm, breadthMm, heightMm },
  } = await packageForItems(
    items
      .filter((x) => x.item.variantId)
      .map((x) => ({
        variantId: x.item.variantId!,
        quantity: x.l.quantity,
        unitPricePaise: x.item.unitPricePaise,
      })),
  );
  const returnParcel = { weightGrams, lengthMm, breadthMm, heightMm };
  const shipment = await db.shipment.create({
    data: {
      orderId: req.orderId,
      provider: shippingProvider().name,
      reference,
      isReturn: true,
      pickupLocationId: pickup.id,
      carrier: "Pending courier",
      status: "CREATING",
      attempts: 1,
      ...returnParcel,
    },
  });
  try {
    const ref = await p.createReturn({
      reference,
      orderDate: new Date(),
      pickupLocationName: pickup.name,
      customer: {
        name: a.fullName,
        phone: a.phone,
        email: req.order.email,
        line1: [a.line1, a.line2].filter(Boolean).join(", "),
        city: a.city,
        state: stateName(a.stateCode),
        pincode: a.pincode,
      },
      warehouse: {
        name: pickup.contactName,
        phone: pickup.phone,
        email: pickup.email,
        line1: pickup.line1,
        line2: pickup.line2,
        city: pickup.city,
        state: stateName(pickup.stateCode),
        pincode: pickup.pincode,
      },
      items: items.map((x) => ({
        name: `${x.item.productName} (${x.item.variantName})`.slice(0, 100),
        sku: x.item.sku,
        units: x.l.quantity,
        sellingPricePaise: x.item.unitPricePaise,
        hsn: x.item.hsnCode,
      })),
      subTotalPaise: items.reduce((s, x) => s + x.item.unitPricePaise * x.l.quantity, 0),
      ...returnParcel,
    });
    await db.shipment.update({
      where: { id: shipment.id },
      data: {
        providerOrderId: ref.providerOrderId,
        providerShipmentId: ref.providerShipmentId,
        status: "CREATED",
        trackingNumber: ref.awb ?? null,
      },
    });
    await audit({
      actorId: staff.id,
      action: "shipping.return_pickup",
      entityType: "Order",
      entityId: req.orderId,
      metadata: { requestId, reference },
      ipAddress: staff.ip,
    });
  } catch (error) {
    await db.shipment.update({
      where: { id: shipment.id },
      data: { status: "FAILED", lastError: errorText(error), needsAttention: true },
    });
    captureIntegrationFailure(shippingProvider().name, "create-return", error, { requestId });
    throw new AppError(
      "BUSINESS_RULE",
      isDefinitive(error)
        ? `Courier: ${errorText(error)}`
        : "The courier service is unavailable. Check the shipments page before trying again.",
    );
  }
  return db.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
}

/** Courier options and rates for the admin "Create shipment" dialog (never shown to customers). */
export async function courierQuotes(orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found");
  const pickup = await getDefaultPickupLocation();
  const provider = shippingProvider();
  const est = await packageForItems(
    order.items
      .filter((i) => i.variantId)
      .map((i) => ({
        variantId: i.variantId!,
        quantity: i.quantity,
        unitPricePaise: i.unitPricePaise,
      })),
  );
  if (!pickup || !provider.supportsServiceability)
    return { parcel: est.parcel, couriers: [], recommendedCourierId: null, available: false };
  try {
    const r = await provider.checkServiceability(
      {
        originPincode: pickup.pincode,
        destinationPincode: (order.shippingAddress as AddressSnapshot).pincode,
        cod: order.paymentMethod === "COD",
        declaredValuePaise: order.totalPaise,
        ...est.parcel,
      },
      { timeoutMs: 8000 },
    );
    if (r.kind === "not_serviceable")
      return { parcel: est.parcel, couriers: [], recommendedCourierId: null, available: true };
    const couriers = order.paymentMethod === "COD" ? r.couriers.filter((c) => c.cod) : r.couriers;
    return {
      parcel: est.parcel,
      couriers,
      recommendedCourierId: r.recommendedCourierId,
      available: true,
    };
  } catch {
    return { parcel: est.parcel, couriers: [], recommendedCourierId: null, available: false };
  }
}

export function shippingMode() {
  return shippingProviderName();
}
