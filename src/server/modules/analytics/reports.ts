import "server-only";
import { z } from "zod";
import type { InvoiceSnapshot } from "@/server/modules/invoices/invoices";
import { db } from "@/server/platform/db";
import { SOLD_STATUSES } from "@/server/modules/orders/order-status";
import { stateName } from "@/lib/india";
import { toCsv } from "@/lib/csv";
import { paiseToRupeesString } from "@/lib/money";

const IST_OFFSET_MS = 330 * 60_000;
const MAX_DAYS = 366;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Today's date in India as YYYY-MM-DD. */
export function istToday(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Report period as whole days in India time; `to` is inclusive. Invalid input falls back to the last
 * 30 days; periods are capped at 366 days (the start moves forward).
 */
export const reportRangeSchema = z
  .object({ from: ymd.optional().catch(undefined), to: ymd.optional().catch(undefined) })
  .transform(({ from, to }) => {
    const today = istToday();
    let end = to && !Number.isNaN(Date.parse(to)) ? to : today;
    if (end > today) end = today;
    let start = from && !Number.isNaN(Date.parse(from)) ? from : shiftDays(end, -29);
    if (start > end) start = end;
    if (start < shiftDays(end, -(MAX_DAYS - 1))) start = shiftDays(end, -(MAX_DAYS - 1));
    return {
      from: start,
      to: end,
      /** Inclusive start instant (00:00 IST). */
      start: new Date(Date.parse(`${start}T00:00:00Z`) - IST_OFFSET_MS),
      /** Exclusive end instant (00:00 IST the day after `to`). */
      end: new Date(Date.parse(`${shiftDays(end, 1)}T00:00:00Z`) - IST_OFFSET_MS),
      days: Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1,
    };
  });
export type ReportRange = z.output<typeof reportRangeSchema>;

const SOLD = [...SOLD_STATUSES] as string[];
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

/**
 * Sales report from orders placed in the period. "Sold" = accepted orders (cancelled, unpaid and
 * failed-payment orders excluded); refunds are counted when Razorpay/staff completed them in the
 * period. All amounts are integer paise.
 */
export async function getSalesReport(r: ReportRange) {
  const range = { gte: r.start, lt: r.end };
  const [
    summary,
    units,
    refunds,
    byStatus,
    byMethod,
    daily,
    products,
    categories,
    states,
    coupons,
  ] = await Promise.all([
    db.order.aggregate({
      where: { placedAt: range, status: { in: [...SOLD_STATUSES] } },
      _count: true,
      _sum: {
        subtotalPaise: true,
        discountPaise: true,
        couponDiscountPaise: true,
        shippingPaise: true,
        codFeePaise: true,
        taxPaise: true,
        cgstPaise: true,
        sgstPaise: true,
        igstPaise: true,
        totalPaise: true,
      },
    }),
    db.orderItem.aggregate({
      where: { order: { placedAt: range, status: { in: [...SOLD_STATUSES] } } },
      _sum: { quantity: true },
    }),
    db.refund.aggregate({
      where: { status: "PROCESSED", processedAt: range },
      _count: true,
      _sum: { amountPaise: true },
    }),
    db.order.groupBy({ by: ["status"], where: { placedAt: range }, _count: { _all: true } }),
    db.order.groupBy({
      by: ["paymentMethod"],
      where: { placedAt: range, status: { in: [...SOLD_STATUSES] } },
      _count: { _all: true },
      _sum: { totalPaise: true },
    }),
    db.$queryRaw<{ day: Date; orders: number; sales: bigint }[]>`
        SELECT date_trunc('day', ("placedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata') AS day,
               COUNT(*)::int AS orders, COALESCE(SUM("totalPaise"), 0)::bigint AS sales
        FROM "Order"
        WHERE "placedAt" >= ${r.start} AND "placedAt" < ${r.end} AND status::text = ANY(${SOLD})
        GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<
      {
        productId: string | null;
        variantId: string | null;
        name: string;
        variant: string;
        sku: string;
        units: number;
        sales: bigint;
      }[]
    >`
        SELECT oi."productId", oi."variantId", MAX(oi."productName") AS name, MAX(oi."variantName") AS variant,
               MAX(oi.sku) AS sku, SUM(oi.quantity)::int AS units, SUM(oi."lineTotalPaise")::bigint AS sales
        FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
        WHERE o."placedAt" >= ${r.start} AND o."placedAt" < ${r.end} AND o.status::text = ANY(${SOLD})
        GROUP BY oi."productId", oi."variantId", oi.sku
        ORDER BY sales DESC LIMIT 200`,
    db.$queryRaw<{ category: string | null; units: number; sales: bigint }[]>`
        SELECT c.name AS category, SUM(oi.quantity)::int AS units, SUM(oi."lineTotalPaise")::bigint AS sales
        FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
        LEFT JOIN "Product" p ON p.id = oi."productId" LEFT JOIN "Category" c ON c.id = p."categoryId"
        WHERE o."placedAt" >= ${r.start} AND o."placedAt" < ${r.end} AND o.status::text = ANY(${SOLD})
        GROUP BY c.name ORDER BY sales DESC`,
    db.order.groupBy({
      by: ["shippingStateCode"],
      where: { placedAt: range, status: { in: [...SOLD_STATUSES] } },
      _count: { _all: true },
      _sum: { totalPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true },
      orderBy: { _sum: { totalPaise: "desc" } },
    }),
    db.$queryRaw<{ code: string; uses: number; discount: bigint; sales: bigint }[]>`
        SELECT o."couponCode" AS code, COUNT(*)::int AS uses,
               COALESCE(SUM(o."couponDiscountPaise"), 0)::bigint AS discount,
               COALESCE(SUM(o."totalPaise"), 0)::bigint AS sales
        FROM "Order" o
        WHERE o."placedAt" >= ${r.start} AND o."placedAt" < ${r.end} AND o.status::text = ANY(${SOLD})
          AND o."couponCode" IS NOT NULL
        GROUP BY o."couponCode" ORDER BY uses DESC`,
  ]);

  const s = summary._sum;
  const gross = s.totalPaise ?? 0;
  const refunded = refunds._sum.amountPaise ?? 0;
  const statusCounts = Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])) as Record<
    string,
    number
  >;
  const placed = byStatus.reduce((t, b) => t + b._count._all, 0);
  const sold = summary._count;
  const returned = ["RETURN_REQUESTED", "RETURNED", "REFUND_PENDING", "REFUNDED"].reduce(
    (t, k) => t + (statusCounts[k] ?? 0),
    0,
  );

  const byDay = new Map(daily.map((d) => [d.day.toISOString().slice(0, 10), d]));
  const series: { date: string; sales: number; orders: number }[] = [];
  for (let i = 0; i < r.days; i++) {
    const date = shiftDays(r.from, i);
    const row = byDay.get(date);
    series.push({ date, sales: n(row?.sales), orders: n(row?.orders) });
  }

  return {
    range: { from: r.from, to: r.to, days: r.days },
    summary: {
      placedOrders: placed,
      soldOrders: sold,
      units: units._sum.quantity ?? 0,
      subtotalPaise: s.subtotalPaise ?? 0,
      discountPaise: s.discountPaise ?? 0,
      couponDiscountPaise: s.couponDiscountPaise ?? 0,
      shippingPaise: s.shippingPaise ?? 0,
      codFeePaise: s.codFeePaise ?? 0,
      taxPaise: s.taxPaise ?? 0,
      cgstPaise: s.cgstPaise ?? 0,
      sgstPaise: s.sgstPaise ?? 0,
      igstPaise: s.igstPaise ?? 0,
      grossPaise: gross,
      refundedPaise: refunded,
      refunds: refunds._count,
      netPaise: gross - refunded,
      averageOrderValuePaise: sold > 0 ? Math.round(gross / sold) : 0,
      cancelledOrders: statusCounts.CANCELLED ?? 0,
      unpaidOrders: (statusCounts.PENDING ?? 0) + (statusCounts.PAYMENT_FAILED ?? 0),
      /** Basis points (1/100 %) of placed orders that were cancelled / of sold orders with a return. */
      cancellationRateBps:
        placed > 0 ? Math.round(((statusCounts.CANCELLED ?? 0) * 10_000) / placed) : 0,
      returnRateBps: sold > 0 ? Math.round((returned * 10_000) / sold) : 0,
    },
    statusCounts,
    paymentMethods: byMethod.map((m) => ({
      method: m.paymentMethod,
      orders: m._count._all,
      totalPaise: m._sum.totalPaise ?? 0,
    })),
    series,
    products: products.map((p) => ({ ...p, sales: n(p.sales) })),
    categories: categories.map((c) => ({
      category: c.category ?? "Deleted products",
      units: c.units,
      sales: n(c.sales),
    })),
    states: states.map((st) => ({
      stateCode: st.shippingStateCode,
      stateName: stateName(st.shippingStateCode),
      orders: st._count._all,
      totalPaise: st._sum.totalPaise ?? 0,
      cgstPaise: st._sum.cgstPaise ?? 0,
      sgstPaise: st._sum.sgstPaise ?? 0,
      igstPaise: st._sum.igstPaise ?? 0,
    })),
    coupons: coupons.map((c) => ({ ...c, discount: n(c.discount), sales: n(c.sales) })),
  };
}

/**
 * GST register from issued invoices (their immutable snapshots), by invoice date. Prepared for the
 * accountant's review — the business's own GST filing rules decide how it is used.
 */
export async function getGstRegister(r: ReportRange) {
  const invoices = await db.invoice.findMany({
    where: { issuedAt: { gte: r.start, lt: r.end } },
    orderBy: { issuedAt: "asc" },
    select: {
      invoiceNumber: true,
      issuedAt: true,
      snapshot: true,
      order: { select: { status: true } },
    },
  });
  const rows = invoices.map((inv) => {
    const s = inv.snapshot as unknown as InvoiceSnapshot;
    return {
      invoiceNumber: inv.invoiceNumber,
      issuedAt: inv.issuedAt,
      orderNumber: s.orderNumber,
      orderStatus: inv.order.status,
      documentTitle: s.documentTitle,
      placeOfSupply: `${s.placeOfSupply.stateCode} – ${s.placeOfSupply.stateName}`,
      supplyType: s.supplyType,
      taxableValuePaise: s.totals.taxableValuePaise,
      cgstPaise: s.totals.cgstPaise,
      sgstPaise: s.totals.sgstPaise,
      igstPaise: s.totals.igstPaise,
      taxPaise: s.totals.taxPaise,
      grandTotalPaise: s.totals.grandTotalPaise,
    };
  });
  const totals = rows.reduce(
    (t, x) => ({
      taxableValuePaise: t.taxableValuePaise + x.taxableValuePaise,
      cgstPaise: t.cgstPaise + x.cgstPaise,
      sgstPaise: t.sgstPaise + x.sgstPaise,
      igstPaise: t.igstPaise + x.igstPaise,
      taxPaise: t.taxPaise + x.taxPaise,
      grandTotalPaise: t.grandTotalPaise + x.grandTotalPaise,
    }),
    {
      taxableValuePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      taxPaise: 0,
      grandTotalPaise: 0,
    },
  );
  // HSN summary from invoice lines (charges such as shipping have no HSN here).
  const hsn = new Map<
    string,
    { hsn: string; quantity: number; taxableValuePaise: number; taxPaise: number }
  >();
  for (const inv of invoices) {
    for (const l of (inv.snapshot as unknown as InvoiceSnapshot).lines) {
      const key = l.hsn ?? "—";
      const cur = hsn.get(key) ?? { hsn: key, quantity: 0, taxableValuePaise: 0, taxPaise: 0 };
      cur.quantity += l.quantity;
      cur.taxableValuePaise += l.taxableValuePaise;
      cur.taxPaise += l.cgstPaise + l.sgstPaise + l.igstPaise;
      hsn.set(key, cur);
    }
  }
  return { range: { from: r.from, to: r.to }, rows, totals, hsn: [...hsn.values()] };
}

export const REPORT_EXPORTS = [
  "daily",
  "products",
  "categories",
  "states",
  "coupons",
  "gst",
  "hsn",
] as const;
export type ReportExport = (typeof REPORT_EXPORTS)[number];

const rupees = (p: number) => paiseToRupeesString(p);
const istDate = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Builds one CSV export. Amounts are rupees with two decimals (exact, from integer paise). */
export async function buildReportCsv(kind: ReportExport, r: ReportRange) {
  const file = (name: string) => `shayvera-${name}-${r.from}-to-${r.to}.csv`;
  if (kind === "gst" || kind === "hsn") {
    const g = await getGstRegister(r);
    if (kind === "hsn")
      return {
        filename: file("hsn-summary"),
        csv: toCsv(
          ["HSN", "Quantity", "Taxable value (INR)", "Tax (INR)"],
          g.hsn.map((h) => [h.hsn, h.quantity, rupees(h.taxableValuePaise), rupees(h.taxPaise)]),
        ),
      };
    return {
      filename: file("gst-register"),
      csv: toCsv(
        [
          "Invoice number",
          "Invoice date",
          "Order number",
          "Order status",
          "Document",
          "Place of supply",
          "Supply type",
          "Taxable value (INR)",
          "CGST (INR)",
          "SGST (INR)",
          "IGST (INR)",
          "Total tax (INR)",
          "Invoice total (INR)",
        ],
        g.rows.map((x) => [
          x.invoiceNumber,
          istDate(x.issuedAt),
          x.orderNumber,
          x.orderStatus,
          x.documentTitle,
          x.placeOfSupply,
          x.supplyType,
          rupees(x.taxableValuePaise),
          rupees(x.cgstPaise),
          rupees(x.sgstPaise),
          rupees(x.igstPaise),
          rupees(x.taxPaise),
          rupees(x.grandTotalPaise),
        ]),
      ),
    };
  }
  const s = await getSalesReport(r);
  switch (kind) {
    case "daily":
      return {
        filename: file("daily-sales"),
        csv: toCsv(
          ["Date", "Orders", "Sales (INR)"],
          s.series.map((d) => [d.date, d.orders, rupees(d.sales)]),
        ),
      };
    case "products":
      return {
        filename: file("product-sales"),
        csv: toCsv(
          ["Product", "Variant", "SKU", "Units", "Sales (INR)"],
          s.products.map((p) => [p.name, p.variant, p.sku, p.units, rupees(p.sales)]),
        ),
      };
    case "categories":
      return {
        filename: file("category-sales"),
        csv: toCsv(
          ["Category", "Units", "Sales (INR)"],
          s.categories.map((c) => [c.category, c.units, rupees(c.sales)]),
        ),
      };
    case "states":
      return {
        filename: file("state-sales"),
        csv: toCsv(
          ["State", "Orders", "Sales (INR)", "CGST (INR)", "SGST (INR)", "IGST (INR)"],
          s.states.map((x) => [
            x.stateName,
            x.orders,
            rupees(x.totalPaise),
            rupees(x.cgstPaise),
            rupees(x.sgstPaise),
            rupees(x.igstPaise),
          ]),
        ),
      };
    case "coupons":
      return {
        filename: file("coupon-usage"),
        csv: toCsv(
          ["Coupon", "Orders", "Discount (INR)", "Order value (INR)"],
          s.coupons.map((c) => [c.code, c.uses, rupees(c.discount), rupees(c.sales)]),
        ),
      };
  }
}
