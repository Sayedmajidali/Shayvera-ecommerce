import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  Plus,
  TicketPercent,
  CircleDollarSign,
  ClipboardList,
  IndianRupee,
  Package,
  ShoppingBag,
  Truck,
  Users,
  Undo2,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { RangeTabs } from "@/components/admin/range-tabs";
import { SalesChart } from "@/components/admin/sales-chart";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatINR } from "@/lib/money";
import { firstValues } from "@/lib/search-params";
import {
  getDashboardStats,
  getOperationalAlerts,
  RANGES,
  type RangeKey,
} from "@/server/modules/analytics/dashboard";
import { requireAdminPage } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboard({ searchParams }: PageProps<"/admin">) {
  // Each page authorizes itself: layouts are not re-rendered on client-side navigation.
  const admin = await requireAdminPage("DASHBOARD_VIEW");
  const sp = firstValues(await searchParams);
  const range = (sp.range && sp.range in RANGES ? sp.range : "30d") as RangeKey;
  const [s, alerts] = await Promise.all([
    getDashboardStats(range),
    getOperationalAlerts(admin.permissions),
  ]);
  const label = `last ${RANGES[range]} days`;

  const hour = Number(
    new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" })
      .formatToParts(new Date())
      .find((p) => p.type === "hour")?.value ?? 12,
  );
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = admin.name.trim().split(/\s+/)[0] ?? "";
  const can = (p: (typeof admin.permissions)[number]) => admin.permissions.includes(p);
  const quick = [
    can("ORDERS_VIEW") && {
      href: "/admin/orders?status=CONFIRMED",
      label: `Orders to fulfil${s.toShip ? ` (${s.toShip})` : ""}`,
      icon: Truck,
    },
    can("CATALOG_MANAGE") && { href: "/admin/products/new", label: "Add product", icon: Plus },
    can("COUPONS_MANAGE") && {
      href: "/admin/coupons",
      label: "Create coupon",
      icon: TicketPercent,
    },
    can("REPORTS_VIEW") && { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Truck }[];

  return (
    <>
      <AdminPageHeader
        eyebrow="Overview"
        title={`${greeting}${firstName ? `, ${firstName}` : ""}`}
        description={`Here’s how Shayvera Food is doing over the ${label}.`}
        actions={<RangeTabs current={range} />}
      />
      {quick.length > 0 && (
        <nav aria-label="Quick actions" className="-mt-3 mb-7 flex flex-wrap gap-2">
          {quick.map(({ href, label: text, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="bg-card hover:border-primary/30 hover:text-primary focus-visible:ring-ring/40 inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm shadow-xs transition outline-none focus-visible:ring-[3px]"
            >
              <Icon className="size-4" aria-hidden /> {text}
            </Link>
          ))}
        </nav>
      )}
      {alerts.length > 0 && (
        <section
          aria-label="Needs attention"
          className="mb-7 rounded-2xl border border-[oklch(0.88_0.07_80)] bg-[oklch(0.985_0.025_85)] p-4 text-sm sm:p-5"
          data-testid="ops-alerts"
        >
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="bg-warning-soft flex size-7 items-center justify-center rounded-lg">
              <AlertTriangle className="size-4 text-[oklch(0.55_0.13_70)]" aria-hidden />
            </span>
            Needs attention
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {alerts.map((a) => (
              <li key={a.key}>
                <Link
                  href={a.href}
                  className="group/alert bg-card/80 hover:bg-card flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 transition hover:border-[oklch(0.88_0.07_80)]"
                >
                  <span
                    className={`inline-flex min-w-7 justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${a.severity === "critical" ? "bg-destructive-soft text-destructive" : "bg-warning-soft"}`}
                  >
                    {a.count}
                  </span>
                  <span className="flex-1">{a.label}</span>
                  <ArrowRight
                    className="text-muted-foreground size-4 transition group-hover/alert:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          size="lg"
          label="Gross sales"
          value={formatINR(s.grossSales)}
          hint={`${s.soldOrders} confirmed orders · ${label}`}
          icon={IndianRupee}
        />
        <StatTile
          size="lg"
          label="Net revenue"
          value={formatINR(s.netRevenue)}
          hint={`Collected minus refunds · ${label}`}
          icon={CircleDollarSign}
        />
        <StatTile
          size="lg"
          label="Orders"
          value={String(s.ordersInRange)}
          hint={`Average order ${formatINR(s.averageOrderValue)}`}
          icon={ShoppingBag}
          href="/admin/orders"
        />
        <StatTile
          size="lg"
          label="Customers"
          value={String(s.customers)}
          hint={`${s.newCustomers} new · ${label}`}
          icon={Users}
          href="/admin/customers"
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatTile
          label="Awaiting payment"
          value={String(s.pending)}
          hint="Online orders pending"
          icon={ClipboardList}
          href="/admin/orders?status=PENDING"
        />
        <StatTile
          label="To fulfil"
          value={String(s.toShip)}
          hint="Confirmed & processing"
          icon={Truck}
          href="/admin/orders?status=CONFIRMED"
        />
        <StatTile
          label="Delivered"
          value={String(s.delivered)}
          hint={label}
          icon={Package}
          href="/admin/orders?status=DELIVERED"
        />
        <StatTile
          label="Cancelled"
          value={String(s.cancelled)}
          hint={label}
          icon={XCircle}
          href="/admin/orders?status=CANCELLED"
        />
        <StatTile
          label="Open requests"
          value={String(s.openRequests)}
          hint="Cancellations & returns"
          icon={Undo2}
          href="/admin/requests"
          tone={s.openRequests ? "warning" : undefined}
        />
        <StatTile
          label="Active products"
          value={String(s.products)}
          hint={`${s.lowStock.length} low on stock`}
          icon={Boxes}
          href="/admin/inventory"
          tone={s.lowStock.length ? "warning" : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Daily gross sales</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesChart data={s.series} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Bestsellers</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {s.bestsellers.length === 0 ? (
              <p className="text-muted-foreground px-5 text-sm">No sales in this period yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Product</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="pr-5 text-right">Sales</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.bestsellers.map((b) => (
                    <TableRow key={b.productId ?? b.name}>
                      <TableCell className="max-w-44 truncate pl-5">
                        {b.productId ? (
                          <Link href={`/admin/products/${b.productId}`} className="hover:underline">
                            {b.name}
                          </Link>
                        ) : (
                          b.name
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.units}</TableCell>
                      <TableCell className="pr-5 text-right tabular-nums">
                        {formatINR(b.sales)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent orders</CardTitle>
            <Link
              href="/admin/orders"
              className="text-muted-foreground hover:text-primary inline-flex items-center gap-1 text-sm"
            >
              View all <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </CardHeader>
          <CardContent className="px-0">
            {s.recentOrders.length === 0 ? (
              <p className="text-muted-foreground px-5 text-sm">No orders yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="pr-5 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.recentOrders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="pl-5">
                        <Link
                          href={`/admin/orders/${o.id}`}
                          className="font-medium hover:underline"
                        >
                          {o.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-48 truncate">
                        {o.email}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={o.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {o.paymentMethod} · {o.paymentStatus.toLowerCase()}
                      </TableCell>
                      <TableCell className="pr-5 text-right tabular-nums">
                        {formatINR(o.totalPaise)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Low stock</CardTitle>
            <Link
              href="/admin/inventory"
              className="text-muted-foreground hover:text-primary inline-flex items-center gap-1 text-sm"
            >
              Inventory <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </CardHeader>
          <CardContent>
            {s.lowStock.length === 0 ? (
              <p className="text-muted-foreground text-sm">All products are well stocked.</p>
            ) : (
              <ul className="grid gap-3 text-sm">
                {s.lowStock.map((v) => (
                  <li key={v.variantId} className="flex items-center justify-between gap-3">
                    <Link
                      href={`/admin/products/${v.productId}`}
                      className="min-w-0 hover:underline"
                    >
                      <p className="truncate font-medium">{v.productName}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {v.variantName} · {v.sku}
                      </p>
                    </Link>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${v.available <= 0 ? "bg-destructive-soft text-destructive" : "bg-warning-soft"}`}
                    >
                      {v.available} available
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
