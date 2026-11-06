import { describe, expect, it } from "vitest";
import {
  computeShipmentPackage,
  toCourierUnits,
  volumetricWeightGrams,
} from "@/server/modules/shipping/package";

const defaults = { weightGrams: 500, lengthMm: 200, breadthMm: 150, heightMm: 100 };
const line = (o: Partial<Parameters<typeof computeShipmentPackage>[0][number]> = {}) => ({
  quantity: 1,
  weightGrams: null,
  lengthMm: null,
  breadthMm: null,
  heightMm: null,
  ...o,
});

describe("computeShipmentPackage", () => {
  it("sums weights and stacks heights using each variant's own package", () => {
    const p = computeShipmentPackage(
      [
        line({ quantity: 2, weightGrams: 260, lengthMm: 180, breadthMm: 120, heightMm: 60 }),
        line({ quantity: 1, weightGrams: 1050, lengthMm: 250, breadthMm: 100, heightMm: 90 }),
      ],
      defaults,
    );
    expect(p).toEqual({
      weightGrams: 2 * 260 + 1050,
      lengthMm: 250,
      breadthMm: 120,
      heightMm: 2 * 60 + 90,
      usedDefaults: false,
    });
  });

  it("falls back to the default package and reports it", () => {
    const p = computeShipmentPackage(
      [line({ quantity: 3 }), line({ weightGrams: 100, lengthMm: 10, breadthMm: 10 })],
      defaults,
    );
    expect(p.usedDefaults).toBe(true);
    expect(p.weightGrams).toBe(3 * 500 + 100);
    expect(p.heightMm).toBe(4 * 100); // incomplete box → default box
  });

  it("ignores invalid quantities and returns the default for an empty parcel", () => {
    expect(computeShipmentPackage([line({ quantity: 0 })], defaults)).toEqual({
      ...defaults,
      usedDefaults: true,
    });
  });
});

describe("courier units", () => {
  it("rounds weight to 10 g and dimensions to whole cm, always up", () => {
    expect(
      toCourierUnits({ weightGrams: 1571, lengthMm: 251, breadthMm: 120, heightMm: 5 }),
    ).toEqual({ weightKg: 1.58, lengthCm: 26, breadthCm: 12, heightCm: 1 });
  });

  it("computes volumetric weight", () => {
    // 30 × 20 × 10 cm = 6000 cm³ / 5000 = 1.2 kg
    expect(volumetricWeightGrams({ lengthMm: 300, breadthMm: 200, heightMm: 100 })).toBe(1200);
  });
});
