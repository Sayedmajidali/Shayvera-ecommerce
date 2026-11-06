import type { ServiceabilityResult, ShippingProvider } from "../types";

/** Manual shipping (staff enter courier + AWB themselves): no coverage checks are possible. */
export class ManualShippingProvider implements ShippingProvider {
  readonly name = "manual" as const;
  readonly supportsServiceability = false;

  async checkServiceability(): Promise<ServiceabilityResult> {
    throw new Error("Manual shipping cannot check serviceability");
  }
}
