import type { OrderStatus, ShipmentStatus } from "@prisma/client";

/**
 * Shiprocket shipment status ids (official status-code table) → internal ShipmentStatus.
 * Unknown codes return null: the event is stored but the shipment status is left unchanged.
 */
const SHIPROCKET: Record<number, ShipmentStatus> = {
  1: "AWB_ASSIGNED",
  2: "AWB_ASSIGNED", // label generated
  3: "PICKUP_SCHEDULED",
  4: "PICKUP_SCHEDULED", // pickup queued
  5: "AWB_ASSIGNED", // manifest generated
  6: "IN_TRANSIT", // shipped
  7: "DELIVERED",
  8: "CANCELLED",
  9: "RTO_INITIATED",
  10: "RTO_DELIVERED",
  12: "LOST",
  13: "PICKUP_SCHEDULED", // pickup error (flagged)
  14: "RTO_INITIATED", // RTO acknowledged
  15: "PICKUP_SCHEDULED", // pickup rescheduled
  16: "CANCELLED", // cancellation requested
  17: "OUT_FOR_DELIVERY",
  18: "IN_TRANSIT",
  19: "PICKUP_SCHEDULED", // out for pickup
  20: "PICKUP_SCHEDULED", // pickup exception (flagged)
  21: "UNDELIVERED",
  22: "IN_TRANSIT", // delayed
  23: "DELIVERED", // partial delivered (flagged)
  24: "LOST", // destroyed
  25: "DAMAGED",
  26: "DELIVERED", // fulfilled
  27: "PICKUP_SCHEDULED", // pickup booked
  38: "IN_TRANSIT", // reached destination hub
  39: "IN_TRANSIT", // misrouted (flagged)
  40: "RTO_INITIATED", // RTO NDR
  41: "RTO_INITIATED", // RTO out for delivery
  42: "PICKED_UP",
  44: "LOST", // disposed off
  45: "CANCELLED", // cancelled before dispatch
  46: "RTO_INITIATED", // RTO in transit
};

/** Codes that need a human even though the status mapping is clear. */
const ATTENTION_CODES = new Set([12, 13, 20, 23, 24, 25, 39, 44]);

export function normalizeShiprocketStatus(code: number | null | undefined): ShipmentStatus | null {
  return code != null ? (SHIPROCKET[code] ?? null) : null;
}

export function needsAttentionCode(code: number | null | undefined) {
  return code != null && ATTENTION_CODES.has(code);
}

/** Never overwritten by a later non-terminal event. */
export const TERMINAL_SHIPMENT: readonly ShipmentStatus[] = [
  "DELIVERED",
  "RTO_DELIVERED",
  "CANCELLED",
  "LOST",
];

/** Shipments the tracking job keeps polling. */
export const ACTIVE_SHIPMENT: readonly ShipmentStatus[] = [
  "CREATED",
  "AWB_ASSIGNED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "UNDELIVERED",
  "RTO_INITIATED",
  "DAMAGED",
];

/** Shipments that can still be cancelled at the provider (not yet with the courier). */
export const CANCELLABLE_SHIPMENT: readonly ShipmentStatus[] = [
  "PENDING",
  "CREATING",
  "CREATED",
  "AWB_ASSIGNED",
  "PICKUP_SCHEDULED",
  "FAILED",
];

/**
 * Order status implied by a delivery shipment's status (applied only when the order transition is
 * valid). UNDELIVERED moves an out-for-delivery order back to SHIPPED (failed attempt).
 */
export const ORDER_STATUS_FOR_SHIPMENT: Partial<Record<ShipmentStatus, OrderStatus>> = {
  AWB_ASSIGNED: "READY_TO_SHIP",
  PICKUP_SCHEDULED: "READY_TO_SHIP",
  PICKED_UP: "SHIPPED",
  IN_TRANSIT: "SHIPPED",
  UNDELIVERED: "SHIPPED",
  // A return to origin proves the parcel left us, even if earlier scans were missed or arrived late.
  RTO_INITIATED: "SHIPPED",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  RTO_DELIVERED: "RETURNED",
};

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  PENDING: "Waiting to be booked",
  CREATING: "Booking with courier",
  CREATED: "Booked",
  AWB_ASSIGNED: "Label ready",
  PICKUP_SCHEDULED: "Pickup scheduled",
  PICKED_UP: "Picked up",
  SHIPPED: "Shipped",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  UNDELIVERED: "Delivery attempt failed",
  RTO_INITIATED: "Returning to us",
  RTO_DELIVERED: "Returned to us",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
  LOST: "Lost",
  DAMAGED: "Damaged",
  FAILED: "Booking failed",
};

/** Wording shown to customers: internal steps are merged and courier problems are softened. */
export const CUSTOMER_SHIPMENT_LABEL: Record<ShipmentStatus, string> = {
  ...SHIPMENT_STATUS_LABEL,
  PENDING: "Preparing your shipment",
  CREATING: "Preparing your shipment",
  CREATED: "Packed",
  AWB_ASSIGNED: "Packed, waiting for courier pickup",
  PICKUP_SCHEDULED: "Packed, waiting for courier pickup",
  RTO_INITIATED: "Being returned to us",
  LOST: "Delayed, our team is looking into it",
  DAMAGED: "Delayed, our team is looking into it",
  FAILED: "Preparing your shipment",
};
