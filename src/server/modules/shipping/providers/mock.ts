import { HttpError } from "@/server/platform/http";
import type {
  CreateShipmentInput,
  ProviderShipmentRef,
  ReturnShipmentInput,
  ServiceabilityQuery,
  ServiceabilityResult,
  ShipmentOperations,
  ShippingProvider,
  TrackingResult,
} from "../types";

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
  readonly shipments = new MockShipments();

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

type MockRecord = ProviderShipmentRef & {
  reference: string;
  events: TrackingResult["events"];
  code: number | null;
  cancelled: boolean;
};

/**
 * In-memory courier simulator (development and tests). Mimics Shiprocket: duplicate references are
 * refused with HTTP 422, AWBs are assigned on request, tracking advances only via `advance()`.
 */
export class MockShipments implements ShipmentOperations {
  private byRef = new Map<string, MockRecord>();
  private seq = 1000;

  trackingUrl(awb: string) {
    return `/track?awb=${encodeURIComponent(awb)}`;
  }

  private create(reference: string): ProviderShipmentRef {
    if (this.byRef.has(reference))
      throw new HttpError(
        "mock create-order failed with HTTP 422",
        422,
        { message: "Order Id already exists" },
        false,
      );
    const n = ++this.seq;
    const rec: MockRecord = {
      reference,
      providerOrderId: `9${n}`,
      providerShipmentId: `8${n}`,
      awb: null,
      events: [],
      code: null,
      cancelled: false,
    };
    this.byRef.set(reference, rec);
    return {
      providerOrderId: rec.providerOrderId,
      providerShipmentId: rec.providerShipmentId,
      awb: null,
    };
  }

  private byShipment(id: string) {
    for (const r of this.byRef.values()) if (r.providerShipmentId === id) return r;
    throw new HttpError("mock: shipment not found", 404, { message: "Shipment not found" }, false);
  }

  private byAwb(awb: string) {
    for (const r of this.byRef.values()) if (r.awb === awb) return r;
    return null;
  }

  async createShipment(input: CreateShipmentInput) {
    return this.create(input.reference);
  }

  async findShipmentByReference(reference: string) {
    const r = this.byRef.get(reference);
    return r
      ? { providerOrderId: r.providerOrderId, providerShipmentId: r.providerShipmentId, awb: r.awb }
      : null;
  }

  async assignAwb(p: { providerShipmentId: string; courierId?: string | null }) {
    const r = this.byShipment(p.providerShipmentId);
    r.awb ??= `MOCK${r.providerShipmentId}`;
    this.advance(r.awb, 1, "AWB Assigned");
    return {
      awb: r.awb,
      courierId: p.courierId ?? "mock-surface",
      courierName: p.courierId === "mock-air" ? "Mock Air" : "Mock Surface",
      pickupScheduledAt: new Date(Date.now() + 86_400_000),
    };
  }

  async schedulePickup(p: { providerShipmentId: string }) {
    const r = this.byShipment(p.providerShipmentId);
    if (r.awb) this.advance(r.awb, 3, "Pickup Scheduled");
    return { pickupScheduledAt: new Date(Date.now() + 86_400_000) };
  }

  async generateLabel(providerShipmentId: string) {
    return {
      labelUrl: `/api/shipping/mock-document?kind=label&id=${encodeURIComponent(providerShipmentId)}`,
    };
  }

  async generateManifest(providerShipmentId: string) {
    return {
      manifestUrl: `/api/shipping/mock-document?kind=manifest&id=${encodeURIComponent(providerShipmentId)}`,
    };
  }

  async track(awb: string): Promise<TrackingResult> {
    const r = this.byAwb(awb);
    if (!r) throw new HttpError("mock: unknown AWB", 404, { message: "AWB not found" }, false);
    const latest = r.events.at(-1) ?? null;
    return {
      code: r.code,
      label: latest?.label ?? null,
      occurredAt: latest?.occurredAt ?? null,
      etd: null,
      trackUrl: this.trackingUrl(awb),
      events: [...r.events],
    };
  }

  async cancelShipment(p: { awb?: string | null; providerOrderId?: string | null }) {
    for (const r of this.byRef.values())
      if (
        (p.awb && r.awb === p.awb) ||
        (p.providerOrderId && r.providerOrderId === p.providerOrderId)
      ) {
        r.cancelled = true;
        if (r.awb) this.advance(r.awb, 8, "Canceled");
      }
  }

  async createReturn(input: ReturnShipmentInput) {
    return this.create(input.reference);
  }

  /** Test/dev helper: the courier reports a new status for an AWB. */
  advance(awb: string, code: number, label: string, at = new Date()) {
    const r = this.byAwb(awb);
    if (!r) return;
    r.code = code;
    r.events.push({ code, label, activity: label, location: "Mock hub", occurredAt: at });
  }
}
