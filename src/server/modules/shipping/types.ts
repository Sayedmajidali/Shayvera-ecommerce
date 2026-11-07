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
  /** Present for providers that can book shipments (Shiprocket, mock). */
  readonly shipments?: ShipmentOperations;
}

// ───────────────────────────── Shipment operations (Phase 9) ─────────────────────────────

export type ShipmentAddress = {
  name: string;
  phone: string;
  email: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
};

export type CreateShipmentInput = {
  /** Our unique reference (Shiprocket `order_id`). */
  reference: string;
  orderDate: Date;
  /** Pickup location nickname as configured at the provider. */
  pickupLocationName: string;
  customer: ShipmentAddress;
  items: {
    name: string;
    sku: string;
    units: number;
    sellingPricePaise: number;
    hsn?: string | null;
  }[];
  paymentMethod: "COD" | "PREPAID";
  subTotalPaise: number;
  weightGrams: number;
  lengthMm: number;
  breadthMm: number;
  heightMm: number;
};

export type ProviderShipmentRef = {
  providerOrderId: string;
  providerShipmentId: string;
  awb?: string | null;
};

export type ProviderEvent = {
  /** Provider status code (Shiprocket shipment status id) when known. */
  code: number | null;
  label: string | null;
  activity: string | null;
  location: string | null;
  occurredAt: Date;
};

export type TrackingResult = {
  code: number | null;
  label: string | null;
  occurredAt: Date | null;
  etd: Date | null;
  trackUrl: string | null;
  events: ProviderEvent[];
};

export type ReturnShipmentInput = Omit<CreateShipmentInput, "paymentMethod"> & {
  /** Our warehouse, where the courier delivers the return. */
  warehouse: ShipmentAddress;
};

/** Operations beyond serviceability. Manual shipping implements none of them. */
export interface ShipmentOperations {
  createShipment(input: CreateShipmentInput): Promise<ProviderShipmentRef>;
  /** Looks up a shipment by our reference — used before retrying a create whose outcome is unknown. */
  findShipmentByReference(reference: string): Promise<ProviderShipmentRef | null>;
  assignAwb(p: { providerShipmentId: string; courierId?: string | null }): Promise<{
    awb: string;
    courierId: string | null;
    courierName: string;
    pickupScheduledAt: Date | null;
  }>;
  schedulePickup(p: {
    providerShipmentId: string;
    date?: string | null;
  }): Promise<{ pickupScheduledAt: Date | null }>;
  generateLabel(providerShipmentId: string): Promise<{ labelUrl: string }>;
  generateManifest(providerShipmentId: string): Promise<{ manifestUrl: string }>;
  track(awb: string): Promise<TrackingResult>;
  cancelShipment(p: { awb?: string | null; providerOrderId?: string | null }): Promise<void>;
  createReturn(input: ReturnShipmentInput): Promise<ProviderShipmentRef>;
  trackingUrl(awb: string): string;
}
