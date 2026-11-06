import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  IndianRupee,
  Package,
  ShoppingBag,
  Truck,
  Users,
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
import { getDashboardStats, RANGES, type RangeKey } from "@/server/modules/analytics/dashboard";
import { requireAdminPage } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboard({ searchParams }: PageProps<"/admin">) {
  // Each page authorizes itself: layouts are not re-rendered on client-side navigation.
  await requireAdminPage("DASHBOARD_VIEW");
  const sp = firstValues(await searchParams);
  const range = (sp.range && sp.range in RANGES ? sp.range : "30d") as RangeKey;
  const s = await getDashboardStats(range);
  const label = `last ${RANGES[range]} days`;

  return (
    <>
      <AdminPageHeader
        title="Dashboard"
        description="Live figures from your store database."
        actions={<RangeTabs current={range} />}
      />
      {s.attention > 0 && (
        <Link
          href="/admin/orders?attention=1"
          className="border-warning/50 bg-warning-soft mb-6 flex items-center gap-3 rounded-xl border p-4 text-sm"
        >
          <AlertTriangle className="size-4" /> {s.attention} order(s) need attention (payment
          mismatch, failed automatic refund or late capture). Review now →
        </Link>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Gross sales"
          value={formatINR(s.grossSales)}
          hint={`${s.soldOrders} confirmed orders · ${label}`}
          icon={IndianRupee}
        />
        <StatTile
          label="Net revenue"
          value={formatINR(s.netRevenue)}
          hint={`Collected minus refunds · ${label}`}
          icon={CircleDollarSign}
        />
        <StatTile
          label="Orders"
          value={String(s.ordersInRange)}
          hint={`AOV ${formatINR(s.averageOrderValue)}`}
          icon={ShoppingBag}
          href="/admin/orders"
        />
        <StatTile
          label="Customers"
          value={String(s.customers)}
          hint={`${s.newCustomers} new · ${label}`}
          icon={Users}
          href="/admin/customers"
        />
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
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              View all
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
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              Inventory
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
