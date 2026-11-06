import type { OrderStatus } from "@prisma/client";

/**
 * Order lifecycle state machine — the single source of truth for allowed transitions.
 *
 *   PENDING ──→ PAYMENT_FAILED ──┐
 *      │                         ├──→ CONFIRMED → PROCESSING → READY_TO_SHIP → SHIPPED → OUT_FOR_DELIVERY → DELIVERED
 *      └────────────→ CANCELLED ←┘        │            │              │            └──→ RETURNED (RTO)
 *                         ↑               └── CANCELLATION_REQUESTED ──┘ (approve → CANCELLED, reject → back)
 *   DELIVERED → RETURN_REQUESTED → RETURNED (goods received) · reject → DELIVERED
 *   CANCELLED / RETURNED / DELIVERED → REFUND_PENDING → REFUNDED
 *
 * Payment, shipment and refund states live on their own records; this is the order's business state.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["CONFIRMED", "PAYMENT_FAILED", "CANCELLED"],
  PAYMENT_FAILED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "READY_TO_SHIP", "SHIPPED", "CANCELLATION_REQUESTED", "CANCELLED"],
  PROCESSING: ["READY_TO_SHIP", "SHIPPED", "CANCELLATION_REQUESTED", "CANCELLED"],
  READY_TO_SHIP: ["SHIPPED", "CANCELLATION_REQUESTED", "CANCELLED"],
  SHIPPED: ["OUT_FOR_DELIVERY", "DELIVERED", "RETURNED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "SHIPPED", "RETURNED"],
  DELIVERED: ["RETURN_REQUESTED", "REFUND_PENDING", "REFUNDED"],
  // Approve → CANCELLED; reject/withdraw → the status before the request.
  CANCELLATION_REQUESTED: ["CANCELLED", "CONFIRMED", "PROCESSING", "READY_TO_SHIP"],
  CANCELLED: ["REFUND_PENDING", "REFUNDED"],
  // Goods received → RETURNED; reject/withdraw → DELIVERED.
  RETURN_REQUESTED: ["RETURNED", "DELIVERED"],
  RETURNED: ["REFUND_PENDING", "REFUNDED"],
  REFUND_PENDING: ["REFUNDED"],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Online orders waiting for a successful payment (stock held until the window lapses). */
export const AWAITING_PAYMENT: readonly OrderStatus[] = ["PENDING", "PAYMENT_FAILED"];

/** Accepted orders that have not left the warehouse. */
export const BEFORE_HANDOVER: readonly OrderStatus[] = ["CONFIRMED", "PROCESSING", "READY_TO_SHIP"];

/**
 * Entering one of these statuses means the parcel is packed for the courier: reserved units are
 * deducted (ledger ORDER_FULFILLED). SHIPPED is included for orders that skip READY_TO_SHIP;
 * deduction is idempotent, so moving READY_TO_SHIP → SHIPPED deducts nothing more.
 */
export const STOCK_DEDUCT_STATUSES: readonly OrderStatus[] = ["READY_TO_SHIP", "SHIPPED"];

/** Statuses from which cancellation must give stock back (held, or packed but not handed over). */
export const STOCK_HOLDING_STATUSES: readonly OrderStatus[] = [
  ...AWAITING_PAYMENT,
  ...BEFORE_HANDOVER,
  "CANCELLATION_REQUESTED",
];

/** Unpaid orders can be cancelled by the customer immediately. */
export const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = AWAITING_PAYMENT;

/** Accepted orders the customer can ask to cancel (staff decide). */
export const CANCELLATION_REQUESTABLE: readonly OrderStatus[] = BEFORE_HANDOVER;

/** Orders counted as sales (accepted at some point and not cancelled before handover). */
export const SOLD_STATUSES: readonly OrderStatus[] = [
  "CONFIRMED",
  "PROCESSING",
  "READY_TO_SHIP",
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLATION_REQUESTED",
  "RETURN_REQUESTED",
  "RETURNED",
  "REFUND_PENDING",
  "REFUNDED",
];

/** Orders that can carry a tax invoice. */
export const INVOICEABLE_STATUSES: readonly OrderStatus[] = SOLD_STATUSES;

/** Statuses set only by customer requests, payments or refunds — never from the admin status menu. */
export const REQUEST_DRIVEN: readonly OrderStatus[] = [
  "PAYMENT_FAILED",
  "CANCELLATION_REQUESTED",
  "RETURN_REQUESTED",
  "RETURNED",
  "REFUND_PENDING",
  "REFUNDED",
];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Awaiting payment",
  PAYMENT_FAILED: "Payment failed",
  CONFIRMED: "Confirmed",
  PROCESSING: "Being packed",
  READY_TO_SHIP: "Ready to ship",
  SHIPPED: "Shipped",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLATION_REQUESTED: "Cancellation requested",
  CANCELLED: "Cancelled",
  RETURN_REQUESTED: "Return requested",
  RETURNED: "Returned",
  REFUND_PENDING: "Refund in progress",
  REFUNDED: "Refunded",
};

export type StatusTone = "warning" | "brand" | "success" | "destructive" | "secondary";

/** Badge colour for a status (customer and admin views). */
export const ORDER_STATUS_TONE: Record<OrderStatus, StatusTone> = {
  PENDING: "warning",
  PAYMENT_FAILED: "destructive",
  CONFIRMED: "brand",
  PROCESSING: "brand",
  READY_TO_SHIP: "brand",
  SHIPPED: "brand",
  OUT_FOR_DELIVERY: "brand",
  DELIVERED: "success",
  CANCELLATION_REQUESTED: "warning",
  CANCELLED: "destructive",
  RETURN_REQUESTED: "warning",
  RETURNED: "secondary",
  REFUND_PENDING: "warning",
  REFUNDED: "secondary",
};

/** Customer-facing progress steps; each status maps onto one step. */
export const ORDER_PROGRESS = ["Confirmed", "Packed", "Shipped", "Delivered"] as const;

export function progressStep(status: OrderStatus): number | null {
  switch (status) {
    case "CONFIRMED":
    case "CANCELLATION_REQUESTED":
      return 0;
    case "PROCESSING":
    case "READY_TO_SHIP":
      return 1;
    case "SHIPPED":
    case "OUT_FOR_DELIVERY":
      return 2;
    case "DELIVERED":
    case "RETURN_REQUESTED":
      return 3;
    default:
      return null; // awaiting payment, cancelled, returned, refunds: no progress bar
  }
}
