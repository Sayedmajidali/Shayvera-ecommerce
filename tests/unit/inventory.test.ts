import { describe, expect, it } from "vitest";
import { availableUnits } from "@/server/modules/inventory/available";

describe("available stock", () => {
  it("is on hand minus reserved, never negative, zero without an inventory row", () => {
    expect(availableUnits({ quantityOnHand: 10, quantityReserved: 3 })).toBe(7);
    expect(availableUnits({ quantityOnHand: 3, quantityReserved: 3 })).toBe(0);
    // A drifted row (reserved > on hand) must not advertise negative or phantom stock.
    expect(availableUnits({ quantityOnHand: 2, quantityReserved: 5 })).toBe(0);
    expect(availableUnits(null)).toBe(0);
    expect(availableUnits(undefined)).toBe(0);
  });
});
