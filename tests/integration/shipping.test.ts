import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import { HttpError } from "@/server/platform/http";
import * as bookRoute from "@/app/api/admin/orders/[id]/book-shipment/route";
import * as pickupRoute from "@/app/api/admin/shipments/[id]/pickup/route";
import * as cancelShipRoute from "@/app/api/admin/shipments/[id]/cancel/route";
import * as retryRoute from "@/app/api/admin/shipments/[id]/retry/route";
import * as returnPickupRoute from "@/app/api/admin/requests/[id]/return-pickup/route";
import * as pickupLocationRoute from "@/app/api/admin/pickup-location/route";
import * as courierWebhook from "@/app/api/webhooks/courier/route";
import * as customerCancel from "@/app/api/orders/[orderNumber]/cancel/route";
import { setShippingProvider } from "@/server/modules/shipping/provider";
import { MockShippingProvider, MockShipments } from "@/server/modules/shipping/providers/mock";
import { ManualShippingProvider } from "@/server/modules/shipping/providers/manual";
import { syncTracking } from "@/server/modules/shipping/shipments";
import { approveRequest } from "@/server/modules/orders/requests";
import { transitionOrder } from "@/server/modules/orders/orders";
import { apiRequest, createAdmin, params } from "../helpers/auth";
import { cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { drainJobs } from "../helpers/db";
import { makeProduct } from "../helpers/fixtures";

let provider: MockShippingProvider;
let cookie: string;
let adminId: string;

const pickupLocation = {
  name: "Primary",
  contactName: "Shayvera Warehouse",
  phone: "9845012345",
  email: "ops@example.com",
  line1: "Plot 4, Industrial Area",
  city: "Bengaluru",
  stateCode: "KA",
  pincode: "560058",
};

beforeEach(async () => {
  provider = new MockShippingProvider();
  setShippingProvider(provider);
  const a = await createAdmin();
  cookie = a.cookie;
  adminId = a.user.id;
  const res = await pickupLocationRoute.PUT(
    apiRequest("/api/admin/pickup-location", { method: "PUT", cookie, body: pickupLocation }),
    undefined,
  );
  expect(res.status).toBe(200);
});
afterEach(() => {
  setShippingProvider(null);
  delete process.env.SHIPROCKET_WEBHOOK_TOKEN;
});

async function codOrder(qty = 2) {
  const p = await makeProduct({ stock: 10, price: 40_000 });
  const { json } = await checkout(await cartWith(p.variants[0]!.id, qty), checkoutBody());
  return {
    orderId: json.data.orderId as string,
    orderNumber: json.data.orderNumber as string,
    token: json.data.accessToken as string,
    variantId: p.variants[0]!.id,
  };
}
const book = (orderId: string, body: object = {}) =>
  bookRoute.POST(
    apiRequest(`/api/admin/orders/${orderId}/book-shipment`, { method: "POST", cookie, body }),
    params({ id: orderId }),
  );
const shipmentOf = (orderId: string) =>
  db.shipment.findFirstOrThrow({
    where: { orderId, isReturn: false },
    orderBy: { createdAt: "desc" },
  });
const order = (id: string) => db.order.findUniqueOrThrow({ where: { id } });

function webhook(body: object, token?: string) {
  return courierWebhook.POST(
    new Request("http://localhost:3000/api/webhooks/courier", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-api-key": token } : {}) },
      body: JSON.stringify(body),
    }),
  );
}
const scan = (awb: string, id: number, label: string, at: string) => ({
  awb,
  current_status: label,
  shipment_status: label,
  shipment_status_id: id,
  current_timestamp: at,
  scans: [
    {
      date: at.replace(/^(\d{2}) (\d{2}) (\d{4})/, "$3-$2-$1"),
      activity: label,
      location: "Hub",
      "sr-status": String(id),
      "sr-status-label": label,
    },
  ],
});

describe("booking", () => {
  it("books, assigns an AWB, generates a label and moves the order to READY_TO_SHIP (stock deducted)", async () => {
    const o = await codOrder(2);
    const res = await book(o.orderId, { courierId: "mock-surface" });
    expect(res.status).toBe(201);
    expect((await shipmentOf(o.orderId)).status).toBe("PENDING");
    await drainJobs();
    const s = await shipmentOf(o.orderId);
    expect(s).toMatchObject({
      status: "AWB_ASSIGNED",
      carrier: "Mock Surface",
      provider: "mock",
      codAmountPaise: (await order(o.orderId)).totalPaise,
    });
    expect(s.trackingNumber).toMatch(/^MOCK/);
    expect(s.labelUrl).toContain("kind=label");
    expect(s.reference).toBe(`${o.orderNumber}-1`);
    expect((await order(o.orderId)).status).toBe("READY_TO_SHIP");
    expect(
      await db.inventory.findUniqueOrThrow({ where: { variantId: o.variantId } }),
    ).toMatchObject({ quantityOnHand: 8, quantityReserved: 0 });
    expect(await db.shipmentEvent.count({ where: { shipmentId: s.id } })).toBeGreaterThan(0);
  });

  it("allows only one active shipment per order, even for concurrent clicks", async () => {
    const o = await codOrder();
    const results = await Promise.all([book(o.orderId), book(o.orderId), book(o.orderId)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
  });

  it("an unknown booking outcome is looked up by reference before retrying — no duplicate parcel", async () => {
    class TimeoutAfterCreate extends MockShipments {
      calls = 0;
      override async createShipment(input: Parameters<MockShipments["createShipment"]>[0]) {
        this.calls++;
        await super.createShipment(input);
        if (this.calls === 1)
          throw new HttpError("shiprocket create-order timed out", null, null, true);
        return super.createShipment(input);
      }
    }
    const ships = new TimeoutAfterCreate();
    Object.defineProperty(provider, "shipments", { value: ships });
    const o = await codOrder();
    await book(o.orderId);
    await drainJobs();
    let s = await shipmentOf(o.orderId);
    expect(s.status).toBe("CREATING");
    expect(s.lastError).toMatch(/timed out/);
    await db.job.updateMany({
      where: { type: "shipping.create" },
      data: { runAt: new Date(Date.now() - 1000) },
    });
    await drainJobs();
    s = await shipmentOf(o.orderId);
    expect(s.status).toBe("AWB_ASSIGNED");
    expect(ships.calls).toBe(1); // the retry found it instead of creating again
  });

  it("treats the provider's duplicate-reference error as 'already exists'", async () => {
    const o = await codOrder();
    await book(o.orderId);
    const s = await shipmentOf(o.orderId);
    // The provider already has this reference (e.g. created by a lost earlier request).
    await provider.shipments.createShipment({ reference: s.reference! } as never);
    await drainJobs();
    expect((await shipmentOf(o.orderId)).status).toBe("AWB_ASSIGNED");
  });

  it("a definite refusal marks the booking failed for staff, who can retry after fixing it", async () => {
    let refuse = true;
    class Refusing extends MockShipments {
      override async assignAwb(p: Parameters<MockShipments["assignAwb"]>[0]) {
        if (refuse)
          throw new HttpError(
            "shiprocket assign-awb failed with HTTP 422",
            422,
            { message: "Insufficient wallet balance" },
            false,
          );
        return super.assignAwb(p);
      }
    }
    Object.defineProperty(provider, "shipments", { value: new Refusing() });
    const o = await codOrder();
    await book(o.orderId);
    await drainJobs();
    let s = await shipmentOf(o.orderId);
    expect(s).toMatchObject({ status: "FAILED", needsAttention: true });
    expect(s.lastError).toMatch(/Insufficient wallet balance/);
    refuse = false;
    const retry = await retryRoute.POST(
      apiRequest(`/api/admin/shipments/${s.id}/retry`, { method: "POST", cookie, body: {} }),
      params({ id: s.id }),
    );
    expect(retry.status).toBe(200);
    await drainJobs();
    s = await shipmentOf(o.orderId);
    expect(s.status).toBe("AWB_ASSIGNED");
  });

  it("is refused for manual shipping and without a pickup location", async () => {
    const o = await codOrder();
    setShippingProvider(new ManualShippingProvider());
    expect((await book(o.orderId)).status).toBe(422);
    setShippingProvider(provider);
    await db.pickupLocation.deleteMany();
    const res = await book(o.orderId);
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/pickup location/);
  });

  it("schedules a pickup and stores the manifest", async () => {
    const o = await codOrder();
    await book(o.orderId);
    await drainJobs();
    const s = await shipmentOf(o.orderId);
    const res = await pickupRoute.POST(
      apiRequest(`/api/admin/shipments/${s.id}/pickup`, { method: "POST", cookie, body: {} }),
      params({ id: s.id }),
    );
    expect(res.status).toBe(200);
    expect(await shipmentOf(o.orderId)).toMatchObject({ status: "PICKUP_SCHEDULED" });
    expect((await shipmentOf(o.orderId)).manifestUrl).toContain("kind=manifest");
  });
});

describe("tracking webhooks", () => {
  async function booked() {
    const o = await codOrder();
    await book(o.orderId);
    await drainJobs();
    return { ...o, awb: (await shipmentOf(o.orderId)).trackingNumber! };
  }

  it("authenticates, stores once, and drives the order through shipping to delivery (COD paid)", async () => {
    process.env.SHIPROCKET_WEBHOOK_TOKEN = "courier-token";
    const o = await booked();
    expect(
      (await webhook(scan(o.awb, 18, "IN TRANSIT", "07 11 2026 10:00:00"), "wrong")).status,
    ).toBe(401);
    expect((await webhook(scan(o.awb, 18, "IN TRANSIT", "07 11 2026 10:00:00"))).status).toBe(401);
    const ok = await webhook(scan(o.awb, 18, "IN TRANSIT", "07 11 2026 10:00:00"), "courier-token");
    expect(ok.status).toBe(200);
    const dup = await webhook(
      scan(o.awb, 18, "IN TRANSIT", "07 11 2026 10:00:00"),
      "courier-token",
    );
    expect((await dup.json()).duplicate).toBe(true);
    expect((await order(o.orderId)).status).toBe("READY_TO_SHIP"); // acknowledged before processing
    await drainJobs();
    expect((await order(o.orderId)).status).toBe("SHIPPED");
    expect((await shipmentOf(o.orderId)).status).toBe("IN_TRANSIT");

    await webhook(scan(o.awb, 17, "OUT FOR DELIVERY", "08 11 2026 08:00:00"), "courier-token");
    await drainJobs();
    expect((await order(o.orderId)).status).toBe("OUT_FOR_DELIVERY");
    await webhook(scan(o.awb, 7, "DELIVERED", "08 11 2026 13:00:00"), "courier-token");
    await drainJobs();
    expect(await order(o.orderId)).toMatchObject({ status: "DELIVERED", paymentStatus: "PAID" });
    expect((await shipmentOf(o.orderId)).deliveredAt?.toISOString()).toBe(
      "2026-11-08T07:30:00.000Z",
    );
  });

  it("records late and out-of-order events without moving the status backwards", async () => {
    const o = await booked();
    await webhook(scan(o.awb, 17, "OUT FOR DELIVERY", "08 11 2026 08:00:00"));
    await drainJobs();
    await webhook(scan(o.awb, 42, "PICKED UP", "07 11 2026 09:00:00")); // older, arrives later
    await drainJobs();
    expect((await shipmentOf(o.orderId)).status).toBe("OUT_FOR_DELIVERY");
    await webhook(scan(o.awb, 7, "DELIVERED", "08 11 2026 13:00:00"));
    await drainJobs();
    await webhook(scan(o.awb, 18, "IN TRANSIT", "09 11 2026 09:00:00")); // newer but non-terminal after terminal
    await drainJobs();
    const s = await shipmentOf(o.orderId);
    expect(s.status).toBe("DELIVERED");
    expect(
      await db.shipmentEvent.count({ where: { shipmentId: s.id, providerStatusCode: 42 } }),
    ).toBeGreaterThan(0);
  });

  it("a missed intermediate scan still reaches DELIVERED through SHIPPED", async () => {
    const o = await booked();
    await webhook(scan(o.awb, 7, "DELIVERED", "08 11 2026 13:00:00"));
    await drainJobs();
    const history = await db.orderStatusHistory.findMany({
      where: { orderId: o.orderId },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((h) => h.toStatus).slice(-2)).toEqual(["SHIPPED", "DELIVERED"]);
  });

  it("returns-to-origin end as RETURNED and flag the order", async () => {
    const o = await booked();
    await webhook(scan(o.awb, 18, "IN TRANSIT", "07 11 2026 10:00:00"));
    await webhook(scan(o.awb, 9, "RTO INITIATED", "09 11 2026 10:00:00"));
    await drainJobs();
    expect(await order(o.orderId)).toMatchObject({ status: "SHIPPED", requiresAttention: true });
    await webhook(scan(o.awb, 10, "RTO DELIVERED", "12 11 2026 10:00:00"));
    await drainJobs();
    expect((await order(o.orderId)).status).toBe("RETURNED");
  });

  it("stores unknown AWBs and unknown codes without changing anything", async () => {
    const o = await booked();
    await webhook(scan("NOPE123", 18, "IN TRANSIT", "07 11 2026 10:00:00"));
    await webhook(scan(o.awb, 999, "SOMETHING NEW", "07 11 2026 11:00:00"));
    await drainJobs();
    expect(
      (await db.webhookEvent.findFirstOrThrow({ where: { note: "Unknown AWB" } })).processedAt,
    ).not.toBeNull();
    expect(await shipmentOf(o.orderId)).toMatchObject({
      status: "AWB_ASSIGNED",
      needsAttention: true,
    });
  });

  it("polls stale shipments for updates", async () => {
    const o = await booked();
    provider.shipments.advance(o.awb, 17, "Out For Delivery");
    expect(await syncTracking()).toMatchObject({ checked: 1, updated: 1 });
    expect((await order(o.orderId)).status).toBe("OUT_FOR_DELIVERY");
  });
});

describe("cancellations and returns", () => {
  it("approving a customer's cancellation cancels the courier booking", async () => {
    const o = await codOrder();
    await book(o.orderId);
    await drainJobs();
    await customerCancel.POST(
      apiRequest(`/api/orders/${o.orderNumber}/cancel`, {
        method: "POST",
        body: { token: o.token },
      }),
      params({ orderNumber: o.orderNumber }),
    );
    const req = await db.orderRequest.findFirstOrThrow({ where: { orderId: o.orderId } });
    const res = await approveRequest(req.id, null, { id: adminId });
    // Courier bookings are cancelled automatically, so staff are not asked to do it by hand.
    expect(res.shipmentToCancel).toBe(false);
    await drainJobs();
    expect((await shipmentOf(o.orderId)).status).toBe("CANCELLED");
    expect((await order(o.orderId)).status).toBe("CANCELLED");
    // Packed (deducted at READY_TO_SHIP) but never picked up → units back on hand.
    expect(
      await db.inventory.findUniqueOrThrow({ where: { variantId: o.variantId } }),
    ).toMatchObject({ quantityOnHand: 10, quantityReserved: 0 });
  });

  it("staff cannot cancel once the courier has the parcel", async () => {
    const o = await codOrder();
    await book(o.orderId);
    await drainJobs();
    const s = await shipmentOf(o.orderId);
    await webhook(scan(s.trackingNumber!, 42, "PICKED UP", "07 11 2026 10:00:00"));
    await drainJobs();
    const res = await cancelShipRoute.POST(
      apiRequest(`/api/admin/shipments/${s.id}/cancel`, {
        method: "POST",
        cookie,
        body: { reason: "Customer changed mind" },
      }),
      params({ id: s.id }),
    );
    expect(res.status).toBe(409);
  });

  it("books a return pickup for an approved return, once", async () => {
    const o = await codOrder(1);
    await db.$transaction(async (tx) => {
      for (const to of ["SHIPPED", "DELIVERED"] as const)
        await transitionOrder(tx, { orderId: o.orderId, to, actor: { type: "SYSTEM" } });
    });
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: o.orderId } });
    const { requestReturn } = await import("@/server/modules/orders/requests");
    await requestReturn(
      o.orderNumber,
      { userId: null, token: o.token },
      { reason: "Pouch arrived torn", lines: [{ orderItemId: item.id, quantity: 1 }] },
    );
    const req = await db.orderRequest.findFirstOrThrow({ where: { orderId: o.orderId } });
    const early = await returnPickupRoute.POST(
      apiRequest(`/api/admin/requests/${req.id}/return-pickup`, {
        method: "POST",
        cookie,
        body: {},
      }),
      params({ id: req.id }),
    );
    expect(early.status).toBe(409); // approve first
    await approveRequest(req.id, null, { id: adminId });
    const res = await returnPickupRoute.POST(
      apiRequest(`/api/admin/requests/${req.id}/return-pickup`, {
        method: "POST",
        cookie,
        body: {},
      }),
      params({ id: req.id }),
    );
    expect(res.status).toBe(201);
    const ret = await db.shipment.findFirstOrThrow({
      where: { orderId: o.orderId, isReturn: true },
    });
    expect(ret).toMatchObject({ status: "CREATED", reference: `${o.orderNumber}-R1` });
    const again = await returnPickupRoute.POST(
      apiRequest(`/api/admin/requests/${req.id}/return-pickup`, {
        method: "POST",
        cookie,
        body: {},
      }),
      params({ id: req.id }),
    );
    expect(again.status).toBe(409);
  });
});

describe("pickup location", () => {
  it("validates, and keeps the store PIN used by checkout checks in sync", async () => {
    expect((await db.storeSettings.findUniqueOrThrow({ where: { id: "default" } })).pincode).toBe(
      "560058",
    );
    const bad = await pickupLocationRoute.PUT(
      apiRequest("/api/admin/pickup-location", {
        method: "PUT",
        cookie,
        body: { ...pickupLocation, pincode: "123" },
      }),
      undefined,
    );
    expect(bad.status).toBe(400);
    expect(await db.pickupLocation.count()).toBe(1);
  });
});
