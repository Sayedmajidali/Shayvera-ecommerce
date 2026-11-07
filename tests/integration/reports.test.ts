import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import * as exportRoute from "@/app/api/admin/reports/export/route";
import * as jobRetryRoute from "@/app/api/admin/jobs/[id]/retry/route";
import {
  buildReportCsv,
  getGstRegister,
  getSalesReport,
  istToday,
  reportRangeSchema,
} from "@/server/modules/analytics/reports";
import { getOperationalAlerts } from "@/server/modules/analytics/dashboard";
import { generateInvoice, listInvoices } from "@/server/modules/invoices/invoices";
import { requestStats } from "@/server/modules/orders/requests";
import { getJobsDashboard } from "@/server/modules/operations/jobs-dashboard";
import { enqueue } from "@/server/platform/jobs/queue";
import type { InvoiceSnapshot } from "@/server/modules/invoices/invoices";
import { apiRequest, createAdmin, params } from "../helpers/auth";
import { address, cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { makeProduct } from "../helpers/fixtures";

/** Places a real COD order (checkout pricing, GST split) and moves it to a fixed date/status. */
async function order(o: {
  at: string;
  status?: "CONFIRMED" | "DELIVERED" | "CANCELLED" | "PENDING" | "RETURNED";
  state?: string;
  price?: number;
  name?: string;
}) {
  const p = await makeProduct({
    price: o.price ?? 118_000,
    stock: 10,
    taxRateBps: 1800,
    name: o.name,
  });
  const cookie = await cartWith(p.variants[0]!.id, 1);
  const { json } = await checkout(
    cookie,
    checkoutBody(
      o.state
        ? { shippingAddress: { ...address, stateCode: o.state, pincode: "400001", city: "Mumbai" } }
        : {},
    ),
  );
  return db.order.update({
    where: { orderNumber: json.data.orderNumber },
    data: { placedAt: new Date(o.at), status: o.status ?? "CONFIRMED" },
  });
}

const range = (from: string, to: string) => reportRangeSchema.parse({ from, to });

describe("report period", () => {
  it("uses whole India-time days with an inclusive end", () => {
    const r = range("2025-01-01", "2025-01-31");
    expect(r.start.toISOString()).toBe("2024-12-31T18:30:00.000Z");
    expect(r.end.toISOString()).toBe("2025-01-31T18:30:00.000Z");
    expect(r.days).toBe(31);
  });

  it("falls back to the last 30 days, clamps the future and caps at 366 days", () => {
    const today = istToday();
    const d = reportRangeSchema.parse({});
    expect(d.to).toBe(today);
    expect(d.days).toBe(30);
    expect(reportRangeSchema.parse({ from: "x", to: "2999-01-01" }).to).toBe(today);
    const long = range("2020-01-01", "2025-06-30");
    expect(long.days).toBe(366);
    expect(long.to).toBe("2025-06-30");
    const swapped = range("2025-03-10", "2025-03-01");
    expect([swapped.from, swapped.to]).toEqual(["2025-03-01", "2025-03-01"]);
  });
});

describe("sales report", () => {
  it("counts accepted orders by India date, splits tax by state and nets refunds", async () => {
    await db.storeSettings.update({
      where: { id: "default" },
      data: { gstEnabled: true, gstin: "29AAGCB7383J1Z4", stateCode: "KA" },
    });
    // 18:45 UTC on 1 Jan is 00:15 IST on 2 Jan: belongs to 2 Jan.
    const a = await order({ at: "2025-01-01T18:45:00Z" });
    const b = await order({
      at: "2025-01-03T06:00:00Z",
      status: "DELIVERED",
      state: "MH",
      price: 59_000,
    });
    await order({ at: "2025-01-03T07:00:00Z", status: "CANCELLED" });
    await order({ at: "2025-01-03T08:00:00Z", status: "PENDING" });
    await order({ at: "2025-01-01T18:00:00Z" }); // 23:30 IST on 1 Jan: outside the period
    await db.order.update({
      where: { id: b.id },
      data: { couponCode: "WELCOME10", couponDiscountPaise: 5_000 },
    });
    await db.refund.create({
      data: {
        orderId: b.id,
        amountPaise: 10_000,
        reason: "Damaged pack",
        method: "MANUAL",
        status: "PROCESSED",
        processedAt: new Date("2025-01-03T10:00:00Z"),
      },
    });

    const r = await getSalesReport(range("2025-01-02", "2025-01-03"));
    const s = r.summary;
    expect(s.placedOrders).toBe(4);
    expect(s.soldOrders).toBe(2);
    expect(s.grossPaise).toBe(a.totalPaise + b.totalPaise);
    expect(s.refundedPaise).toBe(10_000);
    expect(s.netPaise).toBe(a.totalPaise + b.totalPaise - 10_000);
    expect(s.averageOrderValuePaise).toBe(Math.round((a.totalPaise + b.totalPaise) / 2));
    expect(s.cancelledOrders).toBe(1);
    expect(s.unpaidOrders).toBe(1);
    expect(s.cancellationRateBps).toBe(2500);
    // Intra-state (store state) → CGST+SGST; Maharashtra → IGST.
    expect(s.cgstPaise).toBe(a.cgstPaise);
    expect(s.igstPaise).toBe(b.igstPaise);
    expect(b.igstPaise).toBeGreaterThan(0);
    expect(r.series).toEqual([
      { date: "2025-01-02", orders: 1, sales: a.totalPaise },
      { date: "2025-01-03", orders: 1, sales: b.totalPaise },
    ]);
    expect(r.paymentMethods).toEqual([
      { method: "COD", orders: 2, totalPaise: a.totalPaise + b.totalPaise },
    ]);
    expect(r.states.map((x) => x.stateCode).sort()).toEqual([a.shippingStateCode, "MH"].sort());
    expect(r.coupons).toEqual([
      { code: "WELCOME10", uses: 1, discount: 5_000, sales: b.totalPaise },
    ]);
    expect(r.products).toHaveLength(2);
    expect(r.products.reduce((t, p) => t + p.units, 0)).toBe(2);
    expect(r.categories).toHaveLength(2);
  });

  it("is empty for a period without orders", async () => {
    const r = await getSalesReport(range("2024-02-01", "2024-02-29"));
    expect(r.summary.grossPaise).toBe(0);
    expect(r.summary.averageOrderValuePaise).toBe(0);
    expect(r.series).toHaveLength(29);
  });
});

describe("GST register and CSV exports", () => {
  it("sums invoice snapshots by invoice date and exports exact rupee amounts", async () => {
    const o = await order({
      at: "2025-04-02T06:00:00Z",
      status: "DELIVERED",
      name: "=HYPERLINK(evil)",
    });
    await generateInvoice(o.id, { id: null });
    await db.invoice.update({
      where: { orderId: o.id },
      data: { issuedAt: new Date("2025-04-02T07:00:00Z") },
    });
    const inv = await db.invoice.findUniqueOrThrow({ where: { orderId: o.id } });
    const snap = inv.snapshot as unknown as InvoiceSnapshot;

    const g = await getGstRegister(range("2025-04-01", "2025-04-30"), { rows: true });
    expect(g.rows).toHaveLength(1);
    expect(g.totals.taxableValuePaise).toBe(snap.totals.taxableValuePaise);
    expect(g.totals.taxPaise).toBe(snap.totals.taxPaise);
    expect(g.hsn.reduce((t, h) => t + h.quantity, 0)).toBe(1);
    expect((await getGstRegister(range("2025-05-01", "2025-05-31"))).invoiceCount).toBe(0);

    const gst = await buildReportCsv("gst", range("2025-04-01", "2025-04-30"));
    expect(gst.filename).toBe("shayvera-gst-register-2025-04-01-to-2025-04-30.csv");
    const lines = gst.csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    const t = snap.totals.grandTotalPaise;
    expect(lines[1]).toContain(`${Math.floor(t / 100)}.${String(t % 100).padStart(2, "0")}`);
    expect(lines[1]).toContain(inv.invoiceNumber);

    // Customer/catalogue text that looks like a formula is neutralised.
    const products = await buildReportCsv("products", range("2025-04-01", "2025-04-30"));
    expect(products.csv).toContain("'=HYPERLINK(evil)");
    expect(products.csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it("export route needs REPORTS_VIEW, returns CSV and is audit-logged", async () => {
    const { cookie, user } = await createAdmin("reports@test.local");
    const res = await exportRoute.GET(
      apiRequest("/api/admin/reports/export?report=daily&from=2025-01-01&to=2025-01-07", {
        cookie,
      }),
      undefined as never,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(
      "daily-sales-2025-01-01-to-2025-01-07.csv",
    );
    const body = await res.text();
    expect(body.replace(/^﻿/, "").split("\r\n")[0]).toBe("Date,Orders,Sales (INR)");
    expect(body.trim().split("\r\n")).toHaveLength(8);
    const log = await db.adminAuditLog.findFirstOrThrow({ where: { action: "report.export" } });
    expect(log.actorId).toBe(user.id);
    expect(log.entityId).toBe("daily");

    const bad = await exportRoute.GET(
      apiRequest("/api/admin/reports/export?report=customers", { cookie }),
      undefined as never,
    );
    expect(bad.status).toBe(400);

    await db.user.update({ where: { id: user.id }, data: { adminRoleId: null } });
    const denied = await exportRoute.GET(
      apiRequest("/api/admin/reports/export?report=daily", { cookie }),
      undefined as never,
    );
    expect(denied.status).toBe(403);
  });
});

describe("operational alerts", () => {
  it("lists only the queues the viewer may act on", async () => {
    const delivered = await order({ at: "2025-01-03T06:00:00Z", status: "DELIVERED" });
    await db.order.update({ where: { id: delivered.id }, data: { requiresAttention: true } });
    await db.orderRequest.create({
      data: {
        orderId: delivered.id,
        type: "RETURN",
        status: "PENDING",
        reason: "Leaking pouch",
        previousStatus: "DELIVERED",
      },
    });
    const job = await enqueue("notification.send" as never, {} as never);
    await db.job.update({ where: { id: job! }, data: { status: "DEAD" } });

    const all = await getOperationalAlerts([
      "ORDERS_VIEW",
      "RETURNS_MANAGE",
      "JOBS_MANAGE",
      "PAYMENTS_VIEW",
    ]);
    expect(Object.fromEntries(all.map((a) => [a.key, a.count]))).toEqual({
      attention: 1,
      requests: 1,
      jobs: 1,
      invoices: 1,
    });
    const ordersOnly = await getOperationalAlerts(["ORDERS_VIEW"]);
    expect(ordersOnly.map((a) => a.key).sort()).toEqual(["attention", "invoices"]);
    expect(await getOperationalAlerts([])).toEqual([]);
  });
});

describe("background jobs", () => {
  it("staff with JOBS_MANAGE retry a dead job; other jobs are refused", async () => {
    const { cookie } = await createAdmin("ops@test.local");
    const dead = await enqueue("notification.send" as never, {} as never);
    await db.job.update({
      where: { id: dead! },
      data: { status: "DEAD", attempts: 8, lastError: "SMTP down" },
    });
    const d = await getJobsDashboard({});
    expect(d.stats.dead).toBe(1);
    expect(d.jobs.map((j) => j.id)).toEqual([dead!]);
    expect(d.failingTypes).toEqual([{ type: "notification.send", status: "DEAD", count: 1 }]);
    expect(d.jobs[0]).not.toHaveProperty("payload");

    const res = await jobRetryRoute.POST(
      apiRequest(`/api/admin/jobs/${dead!}/retry`, { method: "POST", cookie, body: {} }),
      params({ id: dead! }),
    );
    expect(res.status).toBe(200);
    const after = await db.job.findUniqueOrThrow({ where: { id: dead! } });
    expect([after.status, after.attempts, after.lastError]).toEqual(["QUEUED", 0, null]);
    expect(await db.adminAuditLog.count({ where: { action: "job.retry", entityId: dead! } })).toBe(
      1,
    );

    const again = await jobRetryRoute.POST(
      apiRequest(`/api/admin/jobs/${dead!}/retry`, { method: "POST", cookie, body: {} }),
      params({ id: dead! }),
    );
    expect(again.status).toBe(409);
  });
});

describe("invoices list and request figures", () => {
  it("lists issued invoices and delivered orders still without one", async () => {
    const a = await order({ at: "2025-01-03T06:00:00Z", status: "DELIVERED" });
    const b = await order({ at: "2025-01-04T06:00:00Z", status: "DELIVERED" });
    await generateInvoice(a.id, { id: null });
    const l = await listInvoices({ page: 1 });
    expect(l.total).toBe(1);
    expect(l.invoices[0]!.order.orderNumber).toBe(a.orderNumber);
    expect(l.invoices[0]!.grandTotalPaise).toBe(a.totalPaise);
    expect(l.uninvoiced.map((o) => o.orderNumber)).toEqual([b.orderNumber]);
    expect((await listInvoices({ page: 1, q: b.orderNumber })).total).toBe(0);
    expect((await listInvoices({ page: 1, fy: "1999-00" })).total).toBe(0);
  });

  it("summarises open requests, decision time and refunds", async () => {
    const o = await order({ at: "2025-01-03T06:00:00Z", status: "DELIVERED" });
    const created = new Date(Date.now() - 5 * 3_600_000);
    await db.orderRequest.create({
      data: {
        orderId: o.id,
        type: "RETURN",
        status: "REJECTED",
        reason: "Changed my mind",
        previousStatus: "DELIVERED",
        createdAt: created,
        resolvedAt: new Date(created.getTime() + 4 * 3_600_000),
      },
    });
    await db.orderRequest.create({
      data: {
        orderId: o.id,
        type: "RETURN",
        status: "PENDING",
        reason: "Leaking pouch",
        previousStatus: "DELIVERED",
      },
    });
    const s = await requestStats();
    expect(s.openReturns).toBe(1);
    expect(s.openCancellations).toBe(0);
    expect(s.decided30d).toBe(1);
    expect(s.rejected30d).toBe(1);
    expect(s.medianDecisionHours).toBe(4);
  });
});

describe("dashboard daily chart", () => {
  it("puts an order placed just after midnight India time on that India day", async () => {
    const today = istToday();
    const at = new Date(`${today}T00:15:00+05:30`);
    if (at.getTime() > Date.now()) return; // the first 15 minutes of an India day
    const o = await order({ at: at.toISOString() });
    const { getDashboardStats } = await import("@/server/modules/analytics/dashboard");
    const s = await getDashboardStats("7d");
    expect(s.series.at(-1)).toEqual({ date: today, orders: 1, sales: o.totalPaise });
  });
});
