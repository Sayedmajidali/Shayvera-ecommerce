import { describe, expect, it } from "vitest";
import { canTransition, ORDER_TRANSITIONS } from "@/server/modules/orders/order-status";
import { financialYear } from "@/server/platform/sequence";

describe("order state machine", () => {
  it.each([
    ["PENDING", "CONFIRMED"],
    ["PENDING", "CANCELLED"],
    ["CONFIRMED", "PROCESSING"],
    ["PROCESSING", "SHIPPED"],
    ["SHIPPED", "DELIVERED"],
    ["DELIVERED", "REFUNDED"],
    ["CANCELLED", "REFUNDED"],
  ] as const)("allows %s → %s", (from, to) => expect(canTransition(from, to)).toBe(true));

  it.each([
    ["PENDING", "SHIPPED"],
    ["PENDING", "DELIVERED"],
    ["SHIPPED", "CANCELLED"],
    ["DELIVERED", "CANCELLED"],
    ["CANCELLED", "CONFIRMED"],
    ["REFUNDED", "PENDING"],
    ["DELIVERED", "SHIPPED"],
  ] as const)("rejects %s → %s", (from, to) => expect(canTransition(from, to)).toBe(false));

  it("has no transitions out of REFUNDED and no self-loops", () => {
    expect(ORDER_TRANSITIONS.REFUNDED).toEqual([]);
    for (const [from, tos] of Object.entries(ORDER_TRANSITIONS)) expect(tos).not.toContain(from);
  });
});

describe("financial year", () => {
  it("rolls over on 1 April IST", () => {
    expect(financialYear(new Date("2026-11-05T00:00:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2027-03-31T18:00:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2027-03-31T18:31:00Z"))).toBe("2027-28"); // 00:01 IST 1 Apr
  });
});

import {
  AWAITING_PAYMENT,
  BEFORE_HANDOVER,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  progressStep,
  REQUEST_DRIVEN,
  STOCK_DEDUCT_STATUSES,
} from "@/server/modules/orders/order-status";

describe("v2 order lifecycle", () => {
  const all = Object.keys(ORDER_TRANSITIONS) as (keyof typeof ORDER_TRANSITIONS)[];

  it("covers all 14 statuses with a label and badge tone", () => {
    expect(all).toHaveLength(14);
    for (const s of all) {
      expect(ORDER_STATUS_LABEL[s]).toBeTruthy();
      expect(ORDER_STATUS_TONE[s]).toBeTruthy();
    }
  });

  it.each([
    ["PENDING", "PAYMENT_FAILED"],
    ["PAYMENT_FAILED", "CONFIRMED"],
    ["PAYMENT_FAILED", "CANCELLED"],
    ["PROCESSING", "READY_TO_SHIP"],
    ["READY_TO_SHIP", "SHIPPED"],
    ["SHIPPED", "OUT_FOR_DELIVERY"],
    ["OUT_FOR_DELIVERY", "SHIPPED"], // failed delivery attempt
    ["OUT_FOR_DELIVERY", "RETURNED"], // RTO
    ["CONFIRMED", "CANCELLATION_REQUESTED"],
    ["READY_TO_SHIP", "CANCELLATION_REQUESTED"],
    ["CANCELLATION_REQUESTED", "CANCELLED"],
    ["CANCELLATION_REQUESTED", "PROCESSING"], // rejected → back
    ["DELIVERED", "RETURN_REQUESTED"],
    ["RETURN_REQUESTED", "RETURNED"],
    ["RETURN_REQUESTED", "DELIVERED"], // rejected → back
    ["RETURNED", "REFUND_PENDING"],
    ["REFUND_PENDING", "REFUNDED"],
  ] as const)("allows %s → %s", (from, to) => expect(canTransition(from, to)).toBe(true));

  it.each([
    ["SHIPPED", "CANCELLATION_REQUESTED"], // already handed over
    ["PENDING", "CANCELLATION_REQUESTED"], // unpaid orders cancel directly
    ["CONFIRMED", "RETURN_REQUESTED"],
    ["RETURN_REQUESTED", "CANCELLED"],
    ["REFUND_PENDING", "CANCELLED"],
    ["PAYMENT_FAILED", "PROCESSING"],
  ] as const)("rejects %s → %s", (from, to) => expect(canTransition(from, to)).toBe(false));

  it("every status is reachable from PENDING", () => {
    const seen = new Set(["PENDING"]);
    const queue = ["PENDING"] as (keyof typeof ORDER_TRANSITIONS)[];
    while (queue.length)
      for (const n of ORDER_TRANSITIONS[queue.shift()!])
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
    expect([...seen].sort()).toEqual([...all].sort());
  });

  it("groups are consistent", () => {
    expect(AWAITING_PAYMENT.every((s) => canTransition(s, "CANCELLED"))).toBe(true);
    expect(BEFORE_HANDOVER.every((s) => canTransition(s, "CANCELLATION_REQUESTED"))).toBe(true);
    expect(STOCK_DEDUCT_STATUSES).toEqual(["READY_TO_SHIP", "SHIPPED"]);
    expect(REQUEST_DRIVEN).not.toContain("CANCELLED");
    expect(progressStep("READY_TO_SHIP")).toBe(1);
    expect(progressStep("OUT_FOR_DELIVERY")).toBe(2);
    expect(progressStep("CANCELLED")).toBeNull();
  });
});
