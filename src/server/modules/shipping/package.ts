/**
 * Estimates the parcel for a set of order lines from each variant's packed weight and box, falling
 * back to the store's default package. Used for courier serviceability quotes and shipment creation.
 *
 * Box estimate (conservative, deliberately simple): units are stacked — the parcel takes the largest
 * length and breadth of any unit and the sum of all unit heights. Staff can override the parcel when
 * creating a shipment; couriers bill the greater of dead and volumetric weight.
 */
export type PackageDims = {
  weightGrams: number;
  lengthMm: number;
  breadthMm: number;
  heightMm: number;
};

export type PackageLine = {
  quantity: number;
  weightGrams: number | null;
  lengthMm: number | null;
  breadthMm: number | null;
  heightMm: number | null;
};

export type ShipmentPackage = PackageDims & {
  /** True when at least one line used the store default (missing weight or box). */
  usedDefaults: boolean;
};

export function computeShipmentPackage(
  lines: PackageLine[],
  defaults: PackageDims,
): ShipmentPackage {
  let weight = 0;
  let length = 0;
  let breadth = 0;
  let height = 0;
  let usedDefaults = false;
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) continue;
    const hasBox = l.lengthMm != null && l.breadthMm != null && l.heightMm != null;
    if (l.weightGrams == null || !hasBox) usedDefaults = true;
    const w = l.weightGrams ?? defaults.weightGrams;
    const [L, B, H] = hasBox
      ? [l.lengthMm!, l.breadthMm!, l.heightMm!]
      : [defaults.lengthMm, defaults.breadthMm, defaults.heightMm];
    weight += w * l.quantity;
    length = Math.max(length, L);
    breadth = Math.max(breadth, B);
    height += H * l.quantity;
  }
  if (weight === 0) return { ...defaults, usedDefaults: true };
  return {
    weightGrams: weight,
    lengthMm: length,
    breadthMm: breadth,
    heightMm: height,
    usedDefaults,
  };
}

/** Courier APIs (e.g. Shiprocket) take kilograms and centimetres; always round up. */
export function toCourierUnits(p: PackageDims) {
  return {
    weightKg: Math.ceil(p.weightGrams / 10) / 100,
    lengthCm: Math.ceil(p.lengthMm / 10),
    breadthCm: Math.ceil(p.breadthMm / 10),
    heightCm: Math.ceil(p.heightMm / 10),
  };
}

/** Volumetric weight in grams using the common courier divisor of 5000 cm³/kg. */
export function volumetricWeightGrams(p: Omit<PackageDims, "weightGrams">, divisor = 5000) {
  const cm3 = (p.lengthMm / 10) * (p.breadthMm / 10) * (p.heightMm / 10);
  return Math.ceil((cm3 / divisor) * 1000);
}
