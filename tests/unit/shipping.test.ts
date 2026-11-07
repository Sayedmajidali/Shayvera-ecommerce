import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCreateOrderBody,
  parseAwbResponse,
  parseIstDateTime,
  parseOrderSearch,
  parseTracking,
  ShiprocketRejected,
  ShiprocketShipments,
} from "@/server/modules/shipping/providers/shiprocket/shipments";
import { ShiprocketClient } from "@/server/modules/shipping/providers/shiprocket/client";
import {
  needsAttentionCode,
  normalizeShiprocketStatus,
  ORDER_STATUS_FOR_SHIPMENT,
} from "@/server/modules/shipping/status";
import { courierWebhookAuthorized } from "@/server/modules/shipping/shipments";

const BASE = "https://apiv2.shiprocket.in/v1/external";

describe("status normalisation (official code table)", () => {
  it.each([
    [1, "AWB_ASSIGNED"],
    [3, "PICKUP_SCHEDULED"],
    [42, "PICKED_UP"],
    [6, "IN_TRANSIT"],
    [18, "IN_TRANSIT"],
    [17, "OUT_FOR_DELIVERY"],
    [7, "DELIVERED"],
    [21, "UNDELIVERED"],
    [9, "RTO_INITIATED"],
    [10, "RTO_DELIVERED"],
    [8, "CANCELLED"],
    [45, "CANCELLED"],
    [12, "LOST"],
    [25, "DAMAGED"],
  ] as const)("code %i → %s", (code, status) =>
    expect(normalizeShiprocketStatus(code)).toBe(status),
  );

  it("leaves unknown codes unmapped and flags exception codes", () => {
    expect(normalizeShiprocketStatus(999)).toBeNull();
    expect(normalizeShiprocketStatus(null)).toBeNull();
    expect(needsAttentionCode(20)).toBe(true); // pickup exception
    expect(needsAttentionCode(18)).toBe(false);
    expect(ORDER_STATUS_FOR_SHIPMENT.RTO_DELIVERED).toBe("RETURNED");
    expect(ORDER_STATUS_FOR_SHIPMENT.CANCELLED).toBeUndefined();
  });
});

describe("IST date parsing", () => {
  it("reads API and webhook formats as India time", () => {
    expect(parseIstDateTime("2022-11-25 14:00:00")?.toISOString()).toBe("2022-11-25T08:30:00.000Z");
    expect(parseIstDateTime("23 05 2023 11:43:52")?.toISOString()).toBe("2023-05-23T06:13:52.000Z");
    expect(parseIstDateTime("2022-06-04")?.toISOString()).toBe("2022-06-03T18:30:00.000Z");
    expect(parseIstDateTime("")).toBeNull();
    expect(parseIstDateTime("garbage")).toBeNull();
  });
});

describe("Shiprocket payloads", () => {
  const input = {
    reference: "SHV26000123-1",
    orderDate: new Date("2026-11-07T04:30:00Z"),
    pickupLocationName: "Primary",
    customer: {
      name: "Asha Rao Kumar",
      phone: "9845012345",
      email: "a@example.com",
      line1: "12 MG Road, Ashok Nagar",
      line2: null,
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
    },
    items: [
      {
        name: "Cashews (250 g)",
        sku: "CASHEW-250",
        units: 2,
        sellingPricePaise: 34_950,
        hsn: "0801",
      },
    ],
    paymentMethod: "COD" as const,
    subTotalPaise: 74_800,
    weightGrams: 610,
    lengthMm: 201,
    breadthMm: 140,
    heightMm: 95,
  };

  it("builds the create-order body in rupees, kg and cm", () => {
    const b = buildCreateOrderBody(input);
    expect(b).toMatchObject({
      order_id: "SHV26000123-1",
      order_date: "2026-11-07 10:00",
      pickup_location: "Primary",
      billing_customer_name: "Asha",
      billing_last_name: "Rao Kumar",
      billing_pincode: "560001",
      shipping_is_billing: true,
      payment_method: "COD",
      sub_total: 748,
      weight: 0.61,
      length: 21,
      breadth: 14,
      height: 10,
    });
    expect(b.order_items[0]).toMatchObject({
      sku: "CASHEW-250",
      units: 2,
      selling_price: 349.5,
      hsn: "0801",
    });
    expect(buildCreateOrderBody({ ...input, paymentMethod: "PREPAID" }).payment_method).toBe(
      "Prepaid",
    );
  });

  it("parses the official AWB response and rejects a failed assignment", () => {
    const ok = parseAwbResponse({
      awb_assign_status: 1,
      response: {
        data: {
          courier_company_id: 142,
          awb_code: "321055706540",
          courier_name: "Amazon Surface",
          pickup_scheduled_date: "2022-11-25 14:00:00",
        },
      },
    });
    expect(ok).toMatchObject({
      awb: "321055706540",
      courierId: "142",
      courierName: "Amazon Surface",
    });
    expect(ok.pickupScheduledAt?.toISOString()).toBe("2022-11-25T08:30:00.000Z");
    expect(() =>
      parseAwbResponse({
        awb_assign_status: 0,
        response: { data: { awb_assign_error: "Insufficient wallet balance" } },
      }),
    ).toThrow(ShiprocketRejected);
  });

  it("parses the official tracking response", () => {
    const t = parseTracking({
      tracking_data: {
        track_status: 1,
        shipment_status: 7,
        shipment_track: [{ awb_code: "141123221084922", current_status: "Delivered", edd: null }],
        shipment_track_activities: [
          {
            date: "2022-07-19 11:37:00",
            status: "DLVD",
            activity: "Delivered",
            location: "MADANPALLI",
            "sr-status": "7",
            "sr-status-label": "DELIVERED",
          },
          {
            date: "2022-07-19 08:00:00",
            activity: "Out for delivery",
            location: "MADANPALLI",
            "sr-status": "17",
            "sr-status-label": "OUT FOR DELIVERY",
          },
          {
            date: "2022-07-18 21:00:00",
            activity: "Bagged",
            location: "Hub",
            "sr-status": "NA",
            "sr-status-label": "NA",
          },
        ],
        track_url: "https://app.shiprocket.in/tracking/awb/141123221084922",
      },
    });
    expect(t).toMatchObject({
      code: 7,
      label: "Delivered",
      trackUrl: "https://app.shiprocket.in/tracking/awb/141123221084922",
    });
    expect(t.occurredAt?.toISOString()).toBe("2022-07-19T06:07:00.000Z");
    expect(t.events.map((e) => e.code)).toEqual([7, 17, null]);
  });

  it("finds an order by our reference", () => {
    const body = {
      data: [
        { id: 1, channel_order_id: "OTHER", shipments: [{ id: 5 }] },
        {
          id: 281248157,
          channel_order_id: "SHV26000123-1",
          shipments: [{ id: 16090281, awb: "321055706540" }],
        },
      ],
    };
    expect(parseOrderSearch(body, "SHV26000123-1")).toEqual({
      providerOrderId: "281248157",
      providerShipmentId: "16090281",
      awb: "321055706540",
    });
    expect(parseOrderSearch(body, "SHV-NOPE")).toBeNull();
  });
});

describe("Shiprocket shipment calls", () => {
  function client(handler: (path: string, init?: RequestInit) => Response) {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url).replace(BASE, "");
      if (path === "/auth/login")
        return Response.json({
          token: `h.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 86400 })).toString("base64url")}.sig-xxxxxxxxxxxx`,
        });
      return handler(path, init);
    });
    return {
      s: new ShiprocketShipments(
        new ShiprocketClient({
          baseUrl: BASE,
          email: "a@b.in",
          password: "x",
          fetchImpl: fetchImpl as typeof fetch,
        }),
      ),
      fetchImpl,
    };
  }

  it("treats a duplicate pickup request as already scheduled", async () => {
    const { s } = client(() =>
      Response.json({ message: "Duplicate request for pickup generation" }),
    );
    await expect(s.schedulePickup({ providerShipmentId: "12847483" })).resolves.toEqual({
      pickupScheduledAt: null,
    });
  });

  it("cancels by AWB, or by Shiprocket order id when no AWB exists", async () => {
    const seen: [string, string][] = [];
    const { s } = client((path, init) => {
      seen.push([path, String(init?.body)]);
      return Response.json({ message: "ok" });
    });
    await s.cancelShipment({ awb: "19041211125783" });
    await s.cancelShipment({ providerOrderId: "16161616" });
    expect(seen).toEqual([
      ["/orders/cancel/shipment/awbs", JSON.stringify({ awbs: ["19041211125783"] })],
      ["/orders/cancel", JSON.stringify({ ids: [16161616] })],
    ]);
  });

  it("never retries the create call on a server error", async () => {
    const { s, fetchImpl } = client(() => new Response("{}", { status: 503 }));
    await expect(
      s.createShipment({
        reference: "R-1",
        orderDate: new Date(),
        pickupLocationName: "Primary",
        customer: {
          name: "A B",
          phone: "9845012345",
          email: "a@b.in",
          line1: "x",
          city: "y",
          state: "Karnataka",
          pincode: "560001",
        },
        items: [],
        paymentMethod: "PREPAID",
        subTotalPaise: 100,
        weightGrams: 500,
        lengthMm: 100,
        breadthMm: 100,
        heightMm: 100,
      }),
    ).rejects.toThrow();
    expect(
      fetchImpl.mock.calls.filter(([u]) => String(u).endsWith("/orders/create/adhoc")),
    ).toHaveLength(1);
  });
});

describe("courier webhook token", () => {
  afterEach(() => {
    delete process.env.SHIPROCKET_WEBHOOK_TOKEN;
    vi.unstubAllEnvs();
  });
  it("requires the configured token, and a token at all in production", () => {
    process.env.SHIPROCKET_WEBHOOK_TOKEN = "s3cret-token";
    expect(courierWebhookAuthorized("s3cret-token")).toBe(true);
    expect(courierWebhookAuthorized("s3cret-tokeX")).toBe(false);
    expect(courierWebhookAuthorized(null)).toBe(false);
    delete process.env.SHIPROCKET_WEBHOOK_TOKEN;
    expect(courierWebhookAuthorized(null)).toBe(true); // development without a token
    vi.stubEnv("NODE_ENV", "production");
    expect(courierWebhookAuthorized(null)).toBe(false);
  });
});

describe("create-order response classification", () => {
  it("a success body without ids is an unknown outcome, not a refusal", async () => {
    const {
      parseCreateResponse,
      ShiprocketUnexpectedResponse,
      ShiprocketRejected: Rejected,
    } = await import("@/server/modules/shipping/providers/shiprocket/shipments");
    expect(parseCreateResponse({ order_id: 101, shipment_id: 202, awb_code: "" })).toMatchObject({
      providerOrderId: "101",
      providerShipmentId: "202",
    });
    const err = (() => {
      try {
        parseCreateResponse({ status: "NEW", message: "Order created" });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ShiprocketUnexpectedResponse);
    expect(err).not.toBeInstanceOf(Rejected);
  });
});

describe("courier webhook deduplication key", () => {
  it("is stable for a redelivered scan and different for a new scan", async () => {
    const { courierWebhookDedupeKey } = await import("@/server/modules/shipping/shipments");
    const scan = { awb: "123", shipment_status_id: 17, current_timestamp: "07 11 2026 10:15:00" };
    const a = courierWebhookDedupeKey(scan, '{"x":1}');
    expect(courierWebhookDedupeKey({ ...scan }, '{"x":2,"retry":true}')).toBe(a); // body noise ignored
    expect(courierWebhookDedupeKey({ ...scan, shipment_status_id: 7 }, "")).not.toBe(a);
    expect(
      courierWebhookDedupeKey({ ...scan, current_timestamp: "07 11 2026 10:16:00" }, ""),
    ).not.toBe(a);
    expect(courierWebhookDedupeKey({ ...scan, awb: "124" }, "")).not.toBe(a);
    // Legacy field name is honoured; without a timestamp the raw body decides.
    expect(
      courierWebhookDedupeKey(
        { awb: "123", current_status_id: 17, current_timestamp: scan.current_timestamp },
        "",
      ),
    ).toBe(a);
    const noTime = { awb: "123", shipment_status_id: 17 };
    expect(courierWebhookDedupeKey(noTime, "A")).not.toBe(courierWebhookDedupeKey(noTime, "B"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
