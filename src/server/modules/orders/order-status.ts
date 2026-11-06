import type { OrderStatus } from "@prisma/client";

/**
 * Order lifecycle state machine — the single source of truth for allowed transitions.
 *
 *   PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED → REFUNDED
 *      └─────────┴─────────────┴──→ CANCELLED ──(if paid)──→ REFUNDED
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "SHIPPED", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: ["REFUNDED"],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * Entering one of these statuses means the parcel has left the warehouse: reserved units are
 * deducted from stock (ledger ORDER_FULFILLED). Phase 7 moves this to READY_TO_SHIP.
 */
export const STOCK_DEDUCT_STATUSES: readonly OrderStatus[] = ["SHIPPED"];

/** Statuses in which the order still holds reserved stock that must be released on cancellation. */
export const STOCK_HOLDING_STATUSES: readonly OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
];

/** Customers may cancel themselves until the order is being packed. */
export const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = ["PENDING", "CONFIRMED"];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Awaiting payment",
  CONFIRMED: "Confirmed",
  PROCESSING: "Being packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/** Customer-facing progress steps. */
export const ORDER_PROGRESS: OrderStatus[] = ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"];
