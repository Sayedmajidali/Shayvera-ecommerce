import type { ServiceabilityQuery, ServiceabilityResult, ShippingProvider } from "../types";

/**
 * Deterministic stand-in for a courier aggregator, used in development and tests. Rules:
 * - PIN codes starting with 9 (Army/Field Post Offices) are not serviceable;
 * - PIN codes starting with 79 (remote North-East zone) are prepaid-only (no COD);
 * - estimate: 2 days within the same postal region (first 2 digits), 4 within the same zone
 *   (first digit), otherwise 6.
 * Nothing leaves the server.
 */
export class MockShippingProvider implements ShippingProvider {
  readonly name = "mock" as const;
  readonly supportsServiceability = true;

  async checkServiceability(q: ServiceabilityQuery): Promise<ServiceabilityResult> {
    const dest = q.destinationPincode;
    if (dest.startsWith("9")) return { kind: "not_serviceable" };
    const etaDays =
      dest.slice(0, 2) === q.originPincode.slice(0, 2) ? 2 : dest[0] === q.originPincode[0] ? 4 : 6;
    const cod = !dest.startsWith("79");
    const kg = Math.max(0.5, Math.ceil(q.weightGrams / 500) / 2);
    return {
      kind: "serviceable",
      codAvailable: cod,
      etaDays,
      recommendedCourierId: "mock-surface",
      couriers: [
        {
          courierId: "mock-surface",
          name: "Mock Surface",
          ratePaise: Math.round(kg * 6000),
          cod,
          etaDays,
        },
        {
          courierId: "mock-air",
          name: "Mock Air",
          ratePaise: Math.round(kg * 11000),
          cod: false,
          etaDays: Math.max(1, etaDays - 2),
        },
      ],
    };
  }
}
