/**
 * Internal shipping provider contract. Courier-specific shapes never leave `providers/*`.
 * Phase 6 needs serviceability; shipment operations are added in Phase 9.
 */
export type ServiceabilityQuery = {
  originPincode: string;
  destinationPincode: string;
  /** Ask about cash-on-delivery. */
  cod: boolean;
  weightGrams: number;
  lengthMm: number;
  breadthMm: number;
  heightMm: number;
  declaredValuePaise: number;
};

export type CourierOption = {
  courierId: string;
  name: string;
  /** Courier charge quoted to the business (not what the customer pays). */
  ratePaise: number | null;
  cod: boolean;
  etaDays: number | null;
};

export type ServiceabilityResult =
  | {
      kind: "serviceable";
      codAvailable: boolean;
      /** Fastest quoted estimate across couriers. */
      etaDays: number | null;
      couriers: CourierOption[];
      recommendedCourierId: string | null;
    }
  | { kind: "not_serviceable" };

export interface ShippingProvider {
  readonly name: "shiprocket" | "mock" | "manual";
  /** False for providers that cannot check coverage (manual shipping). */
  readonly supportsServiceability: boolean;
  checkServiceability(
    q: ServiceabilityQuery,
    opts: { timeoutMs: number },
  ): Promise<ServiceabilityResult>;
}
