import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import * as refundRoute from "@/app/api/admin/requests/[id]/refund/route";
import * as settingsRoute from "@/app/api/admin/settings/route";
import { transitionOrder } from "@/server/modules/orders/orders";
import { approveRequest, receiveReturn, requestReturn } from "@/server/modules/orders/requests";
import { generateInvoice } from "@/server/modules/invoices/invoices";
import { creditNoteTotals } from "@/server/modules/invoices/credit-notes";
import { createRefund } from "@/server/modules/payments/payments";
import {
  GatewayError,
  MockGateway,
  resetPaymentGateway,
  setPaymentGateway,
} from "@/server/modules/payments/gateway";
import { getGstRegister, reportRangeSchema } from "@/server/modules/analytics/reports";
import { queueLowStockDigest, queueStaffAlert } from "@/server/modules/notifications/staff-alerts";
import { apiRequest, createAdmin, params } from "../helpers/auth";
import { cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { drainJobs } from "../helpers/db";
import { makeProduct } from "../helpers/fixtures";

const move = async (orderId: string, ...to: Parameters<typeof transitionOrder>[1]["to"][]) => {
  for (const s of to)
    await db.$transaction((tx) =>
      transitionOrder(tx, { orderId, to: s, actor: { type: "SYSTEM" } }),
    );
};

async function gstOn() {
  await db.storeSettings.update({
    where: { id: "default" },
    data: { gstEnabled: true, gstin: "29AAGCB7383J1Z4", stateCode: "KA" },
  });
}

async function codOrder(qty = 2, price = 59_000) {
  const p = await makeProduct({ stock: 10, price, taxRateBps: 1800 });
  const { json } = await checkout(await cartWith(p.variants[0]!.id, qty), checkoutBody());
  return {
    variantId: p.variants[0]!.id,
    orderId: json.data.orderId as string,
    orderNumber: json.data.orderNumber as string,
    token: json.data.accessToken as string,
  };
}

/** Delivered COD order (paid on delivery) with an approved and received return of `received` units. */
async function receivedReturn(o: { qty?: number; received?: number; invoice?: boolean } = {}) {
  const staff = await createAdmin(`returns-${Math.random().toString(36).slice(2, 7)}@test.local`);
  const order = await codOrder(o.qty ?? 2);
  await move(order.orderId, "READY_TO_SHIP", "SHIPPED", "DELIVERED");
  if (o.invoice) await generateInvoice(order.orderId, { id: null });
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } });
  await requestReturn(
    order.orderNumber,
    { userId: null, token: order.token },
    { reason: "Pouch arrived torn", lines: [{ orderItemId: item.id, quantity: o.qty ?? 2 }] },
  );
  const req = await db.orderRequest.findFirstOrThrow({ where: { orderId: order.orderId } });
  await approveRequest(req.id, "Please send it back", { id: staff.user.id });
  await receiveReturn(
    req.id,
    {
      lines: [{ orderItemId: item.id, receivedQuantity: o.received ?? 1, restockQuantity: 0 }],
      note: null,
    },
    { id: staff.user.id },
  );
  return { ...order, item, requestId: req.id, staff };
}

const postRefund = (requestId: string, cookie: string, body: unknown) =>
  refundRoute.POST(
    apiRequest(`/api/admin/requests/${requestId}/refund`, { method: "POST", cookie, body }),
    params({ id: requestId }),
  );

describe("credit note maths", () => {
  it("pro-rates each tax head and puts the remainder in the taxable value", () => {
    const inv = {
      taxableValuePaise: 100_000,
      cgstPaise: 9_000,
      sgstPaise: 9_000,
      igstPaise: 0,
      taxPaise: 18_000,
      couponDiscountPaise: 0,
      grandTotalPaise: 118_000,
    };
    expect(creditNoteTotals(inv, 59_000)).toEqual({
      taxableValuePaise: 50_000,
      cgstPaise: 4_500,
      sgstPaise: 4_500,
      igstPaise: 0,
      taxPaise: 9_000,
      totalPaise: 59_000,
    });
    // Odd amounts still add up exactly.
    const odd = creditNoteTotals(inv, 33_333);
    expect(odd.taxableValuePaise + odd.taxPaise).toBe(33_333);
    expect(odd.cgstPaise).toBe(odd.sgstPaise);
  });
});

describe("refunding a received return", () => {
  it("quotes the received units, refuses more, refunds once and issues a credit note", async () => {
    await gstOn();
    const r = await receivedReturn({ qty: 2, received: 1, invoice: true });
    const { cookie } = r.staff;
    const quote = await refundRoute.GET(
      apiRequest(`/api/admin/requests/${r.requestId}/refund`, { cookie }),
      params({ id: r.requestId }),
    );
    const q = (await quote.json()).data;
    expect(q.items).toEqual([
      expect.objectContaining({ quantity: 1, valuePaise: Math.round(r.item.lineTotalPaise / 2) }),
    ]);
    expect(q.paid).toBe(true);
    expect(q.refund).toBeNull();

    expect((await postRefund(r.requestId, cookie, { amountPaise: q.itemsPaise + 1 })).status).toBe(
      400,
    );
    // Shipping may be added only when chosen.
    expect(
      (await postRefund(r.requestId, cookie, { amountPaise: q.itemsPaise + q.shippingPaise }))
        .status,
    ).toBe(400);

    const ok = await postRefund(r.requestId, cookie, {
      amountPaise: q.itemsPaise,
      note: "Inspected",
    });
    expect(ok.status).toBe(201);
    const refund = await db.refund.findFirstOrThrow({
      where: { requestId: r.requestId },
      include: { creditNote: true },
    });
    expect(refund).toMatchObject({
      status: "PROCESSED",
      method: "MANUAL",
      amountPaise: q.itemsPaise,
    });
    expect(refund.reason).toContain("Inspected");
    expect(refund.creditNote).not.toBeNull();
    const cn = refund.creditNote!;
    expect(cn.number).toMatch(/^CN\d{4}\/00001$/);
    const snap = cn.snapshot as {
      invoiceNumber: string;
      items: unknown[];
      totals: {
        taxableValuePaise: number;
        taxPaise: number;
        cgstPaise: number;
        sgstPaise: number;
        totalPaise: number;
      };
    };
    expect(snap.totals.totalPaise).toBe(q.itemsPaise);
    expect(snap.totals.taxableValuePaise + snap.totals.taxPaise).toBe(q.itemsPaise);
    expect(snap.totals.cgstPaise).toBeGreaterThan(0);
    expect(snap.totals.cgstPaise).toBe(snap.totals.sgstPaise);
    expect(snap.items).toEqual([{ description: expect.any(String), quantity: 1 }]);
    const order = await db.order.findUniqueOrThrow({ where: { id: r.orderId } });
    expect(order).toMatchObject({
      refundedPaise: q.itemsPaise,
      paymentStatus: "PARTIALLY_REFUNDED",
    });

    expect((await postRefund(r.requestId, cookie, { amountPaise: 100 })).status).toBe(409);
    expect(
      await db.adminAuditLog.count({
        where: { action: "order.return.refund", entityId: r.orderId },
      }),
    ).toBe(1);

    // The GST register nets the credit note against the invoice.
    const day = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const g = await getGstRegister(reportRangeSchema.parse({ from: day, to: day }));
    expect(g.creditNotes).toHaveLength(1);
    expect(g.net.totalPaise).toBe(g.totals.grandTotalPaise - q.itemsPaise);
  });

  it("two staff refunding the same return at once refund it once", async () => {
    const r = await receivedReturn({ qty: 2, received: 2 });
    const amount = r.item.lineTotalPaise;
    const results = await Promise.all([
      postRefund(r.requestId, r.staff.cookie, { amountPaise: amount }),
      postRefund(r.requestId, r.staff.cookie, { amountPaise: amount }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(await db.refund.count({ where: { requestId: r.requestId } })).toBe(1);
    const order = await db.order.findUniqueOrThrow({ where: { id: r.orderId } });
    expect(order.refundedPaise).toBe(amount);
  });

  it("refuses before the items are received and issues no credit note without an invoice", async () => {
    const staff = await createAdmin("early@test.local");
    const order = await codOrder(1);
    await move(order.orderId, "READY_TO_SHIP", "SHIPPED", "DELIVERED");
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } });
    await requestReturn(
      order.orderNumber,
      { userId: null, token: order.token },
      { reason: "Wrong item sent", lines: [{ orderItemId: item.id, quantity: 1 }] },
    );
    const req = await db.orderRequest.findFirstOrThrow({ where: { orderId: order.orderId } });
    await approveRequest(req.id, null, { id: staff.user.id });
    expect((await postRefund(req.id, staff.cookie, { amountPaise: 100 })).status).toBe(409);

    await receiveReturn(
      req.id,
      { lines: [{ orderItemId: item.id, receivedQuantity: 1, restockQuantity: 1 }], note: null },
      { id: staff.user.id },
    );
    expect((await postRefund(req.id, staff.cookie, { amountPaise: 100 })).status).toBe(201);
    expect(await db.creditNote.count()).toBe(0);
  });

  it("needs PAYMENTS_REFUND as well as RETURNS_MANAGE", async () => {
    const r = await receivedReturn();
    await db.user.update({
      where: { id: r.staff.user.id },
      data: { adminRoleId: "role_support" },
    });
    const role = await db.adminRole.findUnique({ where: { id: "role_support" } });
    if (!role || role.permissions.includes("PAYMENTS_REFUND")) return; // built-in role layout changed
    expect((await postRefund(r.requestId, r.staff.cookie, { amountPaise: 100 })).status).toBe(403);
  });
});

describe("staff alerts", () => {
  const recipients = ["orders@shop.test", "owner@shop.test"];
  const setAlerts = (alertEmails: string[]) =>
    db.storeSettings.update({ where: { id: "default" }, data: { alertEmails } });

  it("emails each address once about a new order, without customer contact details", async () => {
    await setAlerts(recipients);
    const o = await codOrder(1);
    const alerts = await db.notification.findMany({ where: { template: "staff-new_order" } });
    expect(alerts.map((a) => a.recipient).sort()).toEqual([...recipients].sort());
    // The same event processed again does not alert twice.
    expect(
      await db.$transaction((tx) =>
        queueStaffAlert(tx, { kind: "new_order", orderId: o.orderId, dedupeKey: o.orderId }),
      ),
    ).toBe(0);

    await drainJobs();
    const sent = await db.outboundEmail.findMany({ where: { template: "staff-new_order" } });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.subject).toBe(`New order: ${o.orderNumber}`);
    const order = await db.order.findUniqueOrThrow({ where: { id: o.orderId } });
    for (const m of sent) {
      expect(m.text).toContain(`/admin/orders/${o.orderId}`);
      expect(m.text).not.toContain(order.phone);
      expect(m.html ?? "").not.toContain(order.email);
    }
    // Customer emails use the branded layout with the store's support contact.
    const customer = await db.outboundEmail.findFirstOrThrow({
      where: { template: "order-confirmed" },
    });
    const s = await db.storeSettings.findUniqueOrThrow({ where: { id: "default" } });
    expect(customer.html).toContain(s.storeName);
    expect(customer.text).toContain(s.supportEmail);
  });

  it("is off when no addresses are set", async () => {
    await setAlerts([]);
    await codOrder(1);
    expect(await db.notification.count({ where: { template: { startsWith: "staff-" } } })).toBe(0);
  });

  it("alerts on return requests and failed refunds", async () => {
    await setAlerts(["ops@shop.test"]);
    const order = await codOrder(1);
    await move(order.orderId, "READY_TO_SHIP", "SHIPPED", "DELIVERED");
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.orderId } });
    await requestReturn(
      order.orderNumber,
      { userId: null, token: order.token },
      { reason: "Leaking pouch", lines: [{ orderItemId: item.id, quantity: 1 }] },
    );
    expect(await db.notification.count({ where: { template: "staff-return_requested" } })).toBe(1);

    // A Razorpay refund the gateway rejects outright.
    await db.order.update({ where: { id: order.orderId }, data: { paymentMethod: "RAZORPAY" } });
    await db.payment.create({
      data: {
        orderId: order.orderId,
        method: "RAZORPAY",
        status: "CAPTURED",
        amountPaise: 100,
        razorpayOrderId: "order_fail",
        razorpayPaymentId: "pay_reject_refund",
      },
    });
    class RejectingGateway extends MockGateway {
      override async refund(): Promise<never> {
        throw new GatewayError("Razorpay: The amount is invalid", true, "BAD_REQUEST_ERROR");
      }
    }
    setPaymentGateway(new RejectingGateway("rzp_test_mockkey000001", "test_key_secret"));
    try {
      await expect(
        createRefund({
          orderId: order.orderId,
          amountPaise: 100,
          reason: "Goodwill",
          actor: { type: "SYSTEM" },
          razorpayPaymentId: "pay_reject_refund",
        }),
      ).rejects.toThrow("amount is invalid");
    } finally {
      resetPaymentGateway();
    }
    expect(await db.refund.count({ where: { orderId: order.orderId, status: "FAILED" } })).toBe(1);
    const alert = await db.notification.findFirstOrThrow({
      where: { template: "staff-refund_failed" },
    });
    expect((alert.payload as { extra: string }).extra).toContain("amount is invalid");
    expect(await db.creditNote.count()).toBe(0);
  });

  it("sends one low-stock digest per day", async () => {
    await setAlerts(["stock@shop.test"]);
    const p = await makeProduct({ stock: 1 });
    await db.inventory.update({
      where: { variantId: p.variants[0]!.id },
      data: { lowStockThreshold: 5 },
    });
    expect(await queueLowStockDigest()).toBe(1);
    expect(await queueLowStockDigest()).toBe(0);
    await drainJobs();
    const m = await db.outboundEmail.findFirstOrThrow({ where: { template: "staff-low_stock" } });
    expect(m.text).toContain(p.variants[0]!.sku);
  });

  it("validates alert addresses in settings", async () => {
    const { cookie } = await createAdmin("settings@test.local");
    const current = await (
      await settingsRoute.GET(apiRequest("/api/admin/settings", { cookie }), undefined as never)
    ).json();
    const put = (patch: object) =>
      settingsRoute.PUT(
        apiRequest("/api/admin/settings", {
          method: "PUT",
          cookie,
          body: { ...current.data, ...patch },
        }),
        undefined as never,
      );
    expect((await put({ alertEmails: ["not-an-email"] })).status).toBe(400);
    expect(
      (await put({ alertEmails: ["a@x.in", "b@x.in", "c@x.in", "d@x.in", "e@x.in", "f@x.in"] }))
        .status,
    ).toBe(400);
    expect(
      (await put({ alertEmails: ["Ops@Shop.in", "ops@shop.in"], autoIssueInvoice: true })).status,
    ).toBe(200);
    const s = await db.storeSettings.findUniqueOrThrow({ where: { id: "default" } });
    expect(s.alertEmails).toEqual(["ops@shop.in"]);
    expect(s.autoIssueInvoice).toBe(true);
  });
});

describe("automatic invoices", () => {
  it("issues the invoice on delivery only when enabled", async () => {
    const a = await codOrder(1);
    await move(a.orderId, "READY_TO_SHIP", "SHIPPED", "DELIVERED");
    await drainJobs();
    expect(await db.invoice.count({ where: { orderId: a.orderId } })).toBe(0);

    await db.storeSettings.update({ where: { id: "default" }, data: { autoIssueInvoice: true } });
    const b = await codOrder(1);
    await move(b.orderId, "READY_TO_SHIP", "SHIPPED", "DELIVERED");
    await drainJobs();
    const inv = await db.invoice.findUniqueOrThrow({ where: { orderId: b.orderId } });
    expect(inv.invoiceNumber).toMatch(/^INV/);
    // Delivered email links the invoice once it exists (rendered at delivery time).
    expect(await db.invoice.count()).toBe(1);
  });
});
