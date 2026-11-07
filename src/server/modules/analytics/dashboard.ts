import { hasPermission, type Permission } from "@/server/modules/auth/permissions";
import { db } from "@/server/platform/db";
import { listLowStock } from "@/server/modules/inventory/inventory";
import {
  AWAITING_PAYMENT,
  BEFORE_HANDOVER,
  SOLD_STATUSES as SOLD,
} from "@/server/modules/orders/order-status";

export const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type RangeKey = keyof typeof RANGES;

/** Orders that count as sales: placed and not cancelled/awaiting payment. */
const SOLD_STATUSES = [...SOLD];

/**
 * Dashboard figures computed directly from PostgreSQL.
 * - Gross sales: total value of confirmed (not cancelled, not unpaid-pending) orders placed in the range.
 * - Net revenue: money actually collected in the range (paid online orders + delivered COD orders) minus refunds.
 */
export async function getDashboardStats(range: RangeKey = "30d") {
  const days = RANGES[range];
  const since = new Date(Date.now() - days * 86_400_000);

  const [
    sales,
    revenue,
    ordersInRange,
    customers,
    newCustomers,
    products,
    pending,
    toShip,
    delivered,
    cancelled,
    openRequests,
    lowStock,
    recentOrders,
    trend,
    best,
  ] = await Promise.all([
    db.order.aggregate({
      where: { placedAt: { gte: since }, status: { in: [...SOLD_STATUSES] } },
      _sum: { totalPaise: true },
      _count: true,
    }),
    db.order.aggregate({
      where: {
        placedAt: { gte: since },
        paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] },
      },
      _sum: { totalPaise: true, refundedPaise: true },
    }),
    db.order.count({ where: { placedAt: { gte: since } } }),
    db.user.count({ where: { role: "CUSTOMER" } }),
    db.user.count({ where: { role: "CUSTOMER", createdAt: { gte: since } } }),
    db.product.count({ where: { status: "ACTIVE" } }),
    db.order.count({ where: { status: { in: [...AWAITING_PAYMENT] } } }),
    db.order.count({ where: { status: { in: [...BEFORE_HANDOVER, "CANCELLATION_REQUESTED"] } } }),
    db.order.count({ where: { status: "DELIVERED", placedAt: { gte: since } } }),
    db.order.count({ where: { status: "CANCELLED", placedAt: { gte: since } } }),
    db.orderRequest.count({ where: { status: "PENDING" } }),
    listLowStock(8),
    db.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        orderNumber: true,
        email: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        totalPaise: true,
        createdAt: true,
      },
    }),
    db.$queryRaw<{ day: Date; orders: number; sales: bigint }[]>`
        SELECT date_trunc('day', ("placedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata') AS day,
               COUNT(*)::int AS orders,
               COALESCE(SUM("totalPaise"), 0)::bigint AS sales
        FROM "Order"
        WHERE "placedAt" >= ${since} AND status::text = ANY(${[...SOLD_STATUSES]})
        GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ productId: string | null; name: string; units: number; sales: bigint }[]>`
        SELECT oi."productId", MAX(oi."productName") AS name, SUM(oi.quantity)::int AS units, SUM(oi."lineTotalPaise")::bigint AS sales
        FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
        WHERE o."placedAt" >= ${since} AND o.status::text = ANY(${[...SOLD_STATUSES]})
        GROUP BY oi."productId" ORDER BY units DESC LIMIT 5`,
  ]);

  // Fill missing days so the chart has a continuous axis.
  const byDay = new Map(trend.map((t) => [t.day.toISOString().slice(0, 10), t]));
  const series: { date: string; sales: number; orders: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() + 330 * 60_000 - i * 86_400_000).toISOString().slice(0, 10);
    const row = byDay.get(d);
    series.push({
      date: d,
      sales: row ? Number(row.sales) : 0,
      orders: row ? Number(row.orders) : 0,
    });
  }

  const grossSales = sales._sum.totalPaise ?? 0;
  const netRevenue = (revenue._sum.totalPaise ?? 0) - (revenue._sum.refundedPaise ?? 0);
  return {
    range,
    grossSales,
    netRevenue,
    soldOrders: sales._count,
    ordersInRange,
    averageOrderValue: sales._count > 0 ? Math.round(grossSales / sales._count / 100) * 100 : 0,
    customers,
    newCustomers,
    products,
    pending,
    toShip,
    delivered,
    cancelled,
    openRequests,
    lowStock,
    recentOrders,
    series,
    bestsellers: best.map((b) => ({ ...b, sales: Number(b.sales) })),
  };
}

export type OperationalAlert = {
  key: string;
  count: number;
  label: string;
  href: string;
  severity: "critical" | "warning";
};

/**
 * Work that needs a person: payment and courier failures, dead jobs, open customer requests. Only the
 * queues the viewer may act on are counted (each query runs only when permitted).
 */
export async function getOperationalAlerts(permissions: readonly string[]) {
  const can = (p: Permission) => hasPermission(permissions, p);
  const now = Date.now();
  const count = (enabled: boolean, q: () => Promise<number>) =>
    enabled ? q() : Promise.resolve(0);
  const [
    attention,
    stuckWebhooks,
    refundsPending,
    refundsFailed,
    shipmentIssues,
    pendingRequests,
    awaitingReceipt,
    deadJobs,
    uninvoiced,
  ] = await Promise.all([
    count(can("ORDERS_VIEW"), () => db.order.count({ where: { requiresAttention: true } })),
    count(can("PAYMENTS_VIEW"), () =>
      db.paymentEvent.count({
        where: {
          source: "webhook",
          processedAt: null,
          receivedAt: { lt: new Date(now - 2 * 60_000) },
        },
      }),
    ),
    count(can("PAYMENTS_VIEW"), () =>
      db.refund.count({
        where: { status: "PENDING", createdAt: { lt: new Date(now - 15 * 60_000) } },
      }),
    ),
    count(can("PAYMENTS_VIEW"), () =>
      db.refund.count({
        where: { status: "FAILED", createdAt: { gte: new Date(now - 30 * 86_400_000) } },
      }),
    ),
    count(can("SHIPPING_MANAGE"), () =>
      db.shipment.count({
        where: {
          OR: [
            { needsAttention: true },
            {
              status: "FAILED",
              order: { status: { notIn: ["CANCELLED", "RETURNED", "REFUNDED"] } },
            },
          ],
        },
      }),
    ),
    count(can("RETURNS_MANAGE"), () => db.orderRequest.count({ where: { status: "PENDING" } })),
    count(can("RETURNS_MANAGE"), () =>
      db.orderRequest.count({ where: { type: "RETURN", status: "APPROVED" } }),
    ),
    count(can("JOBS_MANAGE"), () => db.job.count({ where: { status: "DEAD" } })),
    count(can("ORDERS_VIEW"), () =>
      db.order.count({ where: { status: "DELIVERED", invoice: null } }),
    ),
  ]);
  const alerts: OperationalAlert[] = [
    {
      key: "attention",
      count: attention,
      severity: "critical",
      href: "/admin/orders?attention=1",
      label:
        "orders need attention (payment mismatch, failed refund, late capture or unverified delivery)",
    },
    {
      key: "webhooks",
      count: stuckWebhooks,
      severity: "critical",
      href: "/admin/payments",
      label: "Razorpay webhooks not processed",
    },
    {
      key: "refunds-pending",
      count: refundsPending,
      severity: "warning",
      href: "/admin/payments",
      label: "refunds still being confirmed with Razorpay",
    },
    {
      key: "refunds-failed",
      count: refundsFailed,
      severity: "critical",
      href: "/admin/payments",
      label: "refunds failed in the last 30 days",
    },
    {
      key: "shipments",
      count: shipmentIssues,
      severity: "critical",
      href: "/admin/shipments",
      label: "shipments failed or need attention",
    },
    {
      key: "requests",
      count: pendingRequests,
      severity: "warning",
      href: "/admin/requests",
      label: "cancellation or return requests waiting for a decision",
    },
    {
      key: "returns",
      count: awaitingReceipt,
      severity: "warning",
      href: "/admin/requests?status=APPROVED",
      label: "approved returns waiting to be received",
    },
    {
      key: "jobs",
      count: deadJobs,
      severity: "critical",
      href: "/admin/jobs?status=DEAD",
      label: "background jobs out of retries",
    },
    {
      key: "invoices",
      count: uninvoiced,
      severity: "warning",
      href: "/admin/invoices",
      label: "delivered orders without an invoice",
    },
  ];
  return alerts.filter((a) => a.count > 0);
}
