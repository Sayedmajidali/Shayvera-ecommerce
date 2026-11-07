import { z } from "zod";
import { toCourierUnits } from "../../package";
import type {
  CourierOption,
  ServiceabilityQuery,
  ServiceabilityResult,
  ShippingProvider,
} from "../../types";
import { ShiprocketClient, type ShiprocketConfig } from "./client";
import { ShiprocketShipments } from "./shipments";

const num = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : Number(v);
  if (v === "" || !Number.isFinite(n)) {
    ctx.addIssue({ code: "custom", message: "not a number" });
    return z.NEVER;
  }
  return n;
});
const optNum = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    const n = typeof v === "number" ? v : v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  });

/** `GET /courier/serviceability/` — only the fields we use; extra fields are ignored. */
export const serviceabilityResponse = z.object({
  data: z.object({
    available_courier_companies: z.array(
      z.object({
        courier_company_id: num,
        courier_name: z.string(),
        rate: optNum,
        cod: optNum,
        estimated_delivery_days: optNum,
        blocked: optNum,
      }),
    ),
    recommended_courier_company_id: optNum,
  }),
});

/** Maps a Shiprocket serviceability response to the internal result. Throws on unexpected shapes. */
export function parseServiceability(body: unknown): ServiceabilityResult {
  const parsed = serviceabilityResponse.parse(body);
  const couriers: CourierOption[] = parsed.data.available_courier_companies
    .filter((c) => c.blocked !== 1)
    .map((c) => ({
      courierId: String(c.courier_company_id),
      name: c.courier_name,
      ratePaise: c.rate === null ? null : Math.round(c.rate * 100),
      cod: c.cod === 1,
      etaDays: c.estimated_delivery_days,
    }));
  if (couriers.length === 0) return { kind: "not_serviceable" };
  const etas = couriers.map((c) => c.etaDays).filter((d): d is number => d !== null);
  const rec = parsed.data.recommended_courier_company_id;
  return {
    kind: "serviceable",
    codAvailable: couriers.some((c) => c.cod),
    etaDays: etas.length ? Math.min(...etas) : null,
    couriers,
    recommendedCourierId: rec === null ? null : String(rec),
  };
}

export class ShiprocketProvider implements ShippingProvider {
  readonly name = "shiprocket" as const;
  readonly supportsServiceability = true;
  readonly client: ShiprocketClient;
  readonly shipments: ShiprocketShipments;

  constructor(cfg: ShiprocketConfig) {
    this.client = new ShiprocketClient(cfg);
    this.shipments = new ShiprocketShipments(this.client);
  }

  async checkServiceability(q: ServiceabilityQuery, opts: { timeoutMs: number }) {
    const u = toCourierUnits(q);
    // Ask with cod=0 so every courier is listed; each carries its own `cod` flag.
    const body = await this.client.request<unknown>({
      path: "/courier/serviceability/",
      query: {
        pickup_postcode: q.originPincode,
        delivery_postcode: q.destinationPincode,
        cod: 0,
        weight: u.weightKg,
        length: u.lengthCm,
        breadth: u.breadthCm,
        height: u.heightCm,
        declared_value: Math.max(1, Math.ceil(q.declaredValuePaise / 100)),
      },
      operation: "serviceability",
      timeoutMs: opts.timeoutMs,
      idempotent: false, // checkout cannot wait for retries; the caller falls back instead
    });
    return parseServiceability(body);
  }
}
