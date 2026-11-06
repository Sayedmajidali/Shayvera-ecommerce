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
