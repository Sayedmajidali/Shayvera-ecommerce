import { HttpError } from "@/server/platform/http";
import { toCourierUnits } from "../../package";
import type {
  CreateShipmentInput,
  ProviderEvent,
  ProviderShipmentRef,
  ReturnShipmentInput,
  ShipmentOperations,
  TrackingResult,
} from "../../types";
import type { ShiprocketClient } from "./client";

/**
 * Shiprocket shipment operations (official API collection, read 2026-11-06/07). Request/response shapes
 * stay in this file. Creates are never retried blindly: callers look up the reference first.
 */

type Json = Record<string, unknown>;
const rupees = (paise: number) => Math.round(paise) / 100;
const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

/** Shiprocket dates are IST: "YYYY-MM-DD HH:mm:ss" (API) or "DD MM YYYY HH:mm:ss" (webhook). */
export function parseIstDateTime(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+05:30`);
  m = s.match(/^(\d{2}) (\d{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+05:30`);
  return null;
}

function istDateTime(d: Date) {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000).toISOString();
  return `${ist.slice(0, 10)} ${ist.slice(11, 16)}`;
}

/** The provider answered but did not do what was asked (e.g. awb_assign_status 0). Definitive. */
export class ShiprocketRejected extends Error {
  override name = "ShiprocketRejected";
}

/**
 * A success response we cannot read (e.g. ids missing after an API change). The operation may have
 * happened, so this is an *unknown* outcome: retried with a lookup by reference, never treated as a
 * refusal.
 */
export class ShiprocketUnexpectedResponse extends Error {
  override name = "ShiprocketUnexpectedResponse";
}

function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? full, last: parts.slice(1).join(" ") };
}

export function buildCreateOrderBody(i: CreateShipmentInput) {
  const u = toCourierUnits(i);
  const n = splitName(i.customer.name);
  return {
    order_id: i.reference,
    order_date: istDateTime(i.orderDate),
    pickup_location: i.pickupLocationName,
    billing_customer_name: n.first,
    billing_last_name: n.last,
    billing_address: i.customer.line1,
    billing_address_2: i.customer.line2 ?? "",
    billing_city: i.customer.city,
    billing_pincode: i.customer.pincode,
    billing_state: i.customer.state,
    billing_country: "India",
    billing_email: i.customer.email,
    billing_phone: i.customer.phone,
    shipping_is_billing: true,
    order_items: i.items.map((it) => ({
      name: it.name,
      sku: it.sku,
      units: it.units,
      selling_price: rupees(it.sellingPricePaise),
      discount: 0,
      tax: 0,
      hsn: it.hsn ?? "",
    })),
    payment_method: i.paymentMethod === "COD" ? "COD" : "Prepaid",
    sub_total: rupees(i.subTotalPaise),
    length: u.lengthCm,
    breadth: u.breadthCm,
    height: u.heightCm,
    weight: u.weightKg,
  };
}

export function buildReturnBody(i: ReturnShipmentInput) {
  const u = toCourierUnits(i);
  const c = splitName(i.customer.name);
  const w = splitName(i.warehouse.name);
  return {
    order_id: i.reference,
    order_date: istDateTime(i.orderDate).slice(0, 10),
    pickup_customer_name: c.first,
    pickup_last_name: c.last,
    pickup_address: i.customer.line1,
    pickup_address_2: i.customer.line2 ?? "",
    pickup_city: i.customer.city,
    pickup_state: i.customer.state,
    pickup_country: "India",
    pickup_pincode: i.customer.pincode,
    pickup_email: i.customer.email,
    pickup_phone: i.customer.phone,
    shipping_customer_name: w.first,
    shipping_last_name: w.last,
    shipping_address: i.warehouse.line1,
    shipping_address_2: i.warehouse.line2 ?? "",
    shipping_city: i.warehouse.city,
    shipping_country: "India",
    shipping_pincode: i.warehouse.pincode,
    shipping_state: i.warehouse.state,
    shipping_email: i.warehouse.email,
    shipping_phone: i.warehouse.phone,
    order_items: i.items.map((it) => ({
      sku: it.sku,
      name: it.name,
      units: it.units,
      selling_price: rupees(it.sellingPricePaise),
      discount: 0,
      hsn: it.hsn ?? "",
    })),
    payment_method: "PREPAID",
    total_discount: "0",
    sub_total: rupees(i.subTotalPaise),
    length: u.lengthCm,
    breadth: u.breadthCm,
    height: u.heightCm,
    weight: u.weightKg,
  };
}

export function parseCreateResponse(body: unknown): ProviderShipmentRef {
  const b = body as Json;
  const orderId = str(b?.order_id);
  const shipmentId = str(b?.shipment_id);
  if (!orderId || !shipmentId) {
    const message = b?.message ? String(b.message).slice(0, 120) : "";
    // "Wrong Pickup location entered…" comes with the accepted nicknames in `data`: show them.
    const names = Array.isArray(b?.data)
      ? (b.data as unknown[]).filter((n): n is string => typeof n === "string").slice(0, 10)
      : [];
    const hint = /pickup location/i.test(message)
      ? names.length
        ? ` Shiprocket accepts: ${names.map((n) => `"${n}"`).join(", ")} — use one of these as the pickup location name in Admin → Settings.`
        : " Check that the pickup location name in Admin → Settings matches an active pickup address nickname in Shiprocket exactly."
      : "";
    throw new ShiprocketUnexpectedResponse(
      `Unexpected create-order response${message ? `: ${message}` : ""}${hint}`,
    );
  }
  return { providerOrderId: orderId, providerShipmentId: shipmentId, awb: str(b.awb_code) };
}

/** `GET /orders?search=` → the order whose channel order id equals our reference. */
export function parseOrderSearch(body: unknown, reference: string): ProviderShipmentRef | null {
  const data = (body as Json)?.data;
  if (!Array.isArray(data)) return null;
  const hit = (data as Json[]).find((o) => String(o.channel_order_id ?? "") === reference);
  if (!hit) return null;
  const shipments = Array.isArray(hit.shipments) ? (hit.shipments as Json[]) : [];
  const shipmentId = str(shipments[0]?.id) ?? str(hit.shipment_id);
  if (!shipmentId) return null;
  return {
    providerOrderId: String(hit.id),
    providerShipmentId: shipmentId,
    awb: str(shipments[0]?.awb) ?? str(hit.awb_code),
  };
}

export function parseAwbResponse(body: unknown) {
  const b = body as Json;
  const data = ((b?.response as Json)?.data ?? {}) as Json;
  const awb = str(data.awb_code);
  if (Number(b?.awb_assign_status) !== 1 || !awb)
    throw new ShiprocketRejected(
      String(data.awb_assign_error ?? b?.message ?? "AWB could not be assigned"),
    );
  return {
    awb,
    courierId: str(data.courier_company_id),
    courierName: str(data.courier_name) ?? "Courier",
    pickupScheduledAt: parseIstDateTime(data.pickup_scheduled_date),
  };
}

export function parseTracking(body: unknown): TrackingResult {
  const td = ((body as Json)?.tracking_data ?? {}) as Json;
  const track =
    (Array.isArray(td.shipment_track) ? (td.shipment_track as Json[])[0] : undefined) ?? {};
  const activities = Array.isArray(td.shipment_track_activities)
    ? (td.shipment_track_activities as Json[])
    : [];
  const events: ProviderEvent[] = activities
    .map((a) => {
      const code = Number(a["sr-status"]);
      return {
        code: Number.isFinite(code) && code > 0 ? code : null,
        label: str(a["sr-status-label"]) === "NA" ? null : str(a["sr-status-label"]),
        activity: str(a.activity),
        location: str(a.location),
        occurredAt: parseIstDateTime(a.date) ?? new Date(0),
      };
    })
    .filter((e) => e.occurredAt.getTime() > 0);
  const latest = events.reduce<ProviderEvent | null>(
    (m, e) => (!m || e.occurredAt > m.occurredAt ? e : m),
    null,
  );
  const code = Number(td.shipment_status);
  return {
    code: Number.isFinite(code) && code > 0 ? code : null,
    label: str(track.current_status),
    occurredAt: latest?.occurredAt ?? null,
    etd: parseIstDateTime(td.etd) ?? parseIstDateTime(track.edd),
    trackUrl: str(td.track_url),
    events,
  };
}

export class ShiprocketShipments implements ShipmentOperations {
  constructor(private readonly client: ShiprocketClient) {}

  trackingUrl(awb: string) {
    return `https://app.shiprocket.in/tracking/awb/${encodeURIComponent(awb)}`;
  }

  async createShipment(input: CreateShipmentInput) {
    const body = await this.client.request<unknown>({
      method: "POST",
      path: "/orders/create/adhoc",
      json: buildCreateOrderBody(input),
      operation: "create-order",
      idempotent: false,
    });
    return parseCreateResponse(body);
  }

  async findShipmentByReference(reference: string) {
    const body = await this.client.request<unknown>({
      path: "/orders",
      query: { search: reference },
      operation: "find-order",
      idempotent: true,
    });
    return parseOrderSearch(body, reference);
  }

  async assignAwb(p: { providerShipmentId: string; courierId?: string | null }) {
    const body = await this.client.request<unknown>({
      method: "POST",
      path: "/courier/assign/awb",
      json: {
        shipment_id: p.providerShipmentId,
        ...(p.courierId ? { courier_id: p.courierId } : {}),
      },
      operation: "assign-awb",
      idempotent: false,
    });
    return parseAwbResponse(body);
  }

  async schedulePickup(p: { providerShipmentId: string; date?: string | null }) {
    try {
      const body = (await this.client.request<unknown>({
        method: "POST",
        path: "/courier/generate/pickup",
        json: {
          shipment_id: [Number(p.providerShipmentId)],
          ...(p.date ? { pickup_date: [p.date] } : {}),
        },
        operation: "schedule-pickup",
        idempotent: false,
      })) as Json;
      const resp = (body?.response ?? {}) as Json;
      if (Number(body?.pickup_status) !== 1 && !/duplicate/i.test(String(body?.message ?? "")))
        throw new ShiprocketRejected(String(body?.message ?? "Pickup could not be scheduled"));
      return { pickupScheduledAt: parseIstDateTime(resp.pickup_scheduled_date) };
    } catch (error) {
      // "Duplicate request for pickup generation": already scheduled — fine (idempotent for us).
      if (error instanceof HttpError && /duplicate/i.test(JSON.stringify(error.body ?? "")))
        return { pickupScheduledAt: null };
      throw error;
    }
  }

  async generateLabel(providerShipmentId: string) {
    const body = (await this.client.request<unknown>({
      method: "POST",
      path: "/courier/generate/label",
      json: { shipment_id: [Number(providerShipmentId)] },
      operation: "generate-label",
      idempotent: true,
    })) as Json;
    const url = str(body?.label_url);
    if (!url)
      throw new ShiprocketRejected(String(body?.response ?? body?.message ?? "Label not created"));
    return { labelUrl: url };
  }

  /**
   * POST /manifests/generate. If the shipment was already manifested (400 "Manifest already generated",
   * e.g. from the Shiprocket panel) or no URL comes back, fetch the existing one with
   * POST /manifests/print {order_ids} — the documented way to re-download a manifest.
   */
  async generateManifest(providerShipmentId: string, providerOrderId?: string | null) {
    let body: Json;
    try {
      body = (await this.client.request<unknown>({
        method: "POST",
        path: "/manifests/generate",
        json: { shipment_id: [Number(providerShipmentId)] },
        operation: "generate-manifest",
        idempotent: true,
      })) as Json;
    } catch (error) {
      const alreadyManifested =
        error instanceof HttpError &&
        error.status === 400 &&
        /already/i.test(JSON.stringify(error.body ?? ""));
      if (alreadyManifested && providerOrderId) return this.printManifest(providerOrderId);
      throw error;
    }
    const url = str(body?.manifest_url);
    if (url) return { manifestUrl: url };
    if (providerOrderId) return this.printManifest(providerOrderId);
    throw new ShiprocketRejected(String(body?.message ?? "Manifest not created"));
  }

  private async printManifest(providerOrderId: string) {
    const body = (await this.client.request<unknown>({
      method: "POST",
      path: "/manifests/print",
      json: { order_ids: [Number(providerOrderId)] },
      operation: "print-manifest",
      idempotent: true,
    })) as Json;
    const url = str(body?.manifest_url);
    if (!url) throw new ShiprocketRejected(String(body?.message ?? "Manifest not available"));
    return { manifestUrl: url };
  }

  async track(awb: string) {
    const body = await this.client.request<unknown>({
      path: `/courier/track/awb/${encodeURIComponent(awb)}`,
      operation: "track",
      idempotent: true,
    });
    return parseTracking(body);
  }

  async cancelShipment(p: { awb?: string | null; providerOrderId?: string | null }) {
    if (p.awb)
      await this.client.request({
        method: "POST",
        path: "/orders/cancel/shipment/awbs",
        json: { awbs: [p.awb] },
        operation: "cancel-shipment",
        idempotent: true,
      });
    else if (p.providerOrderId)
      await this.client.request({
        method: "POST",
        path: "/orders/cancel",
        json: { ids: [Number(p.providerOrderId)] },
        operation: "cancel-order",
        idempotent: true,
      });
  }

  async createReturn(input: ReturnShipmentInput) {
    const body = await this.client.request<unknown>({
      method: "POST",
      path: "/orders/create/return",
      json: buildReturnBody(input),
      operation: "create-return",
      idempotent: false,
    });
    return parseCreateResponse(body);
  }
}
