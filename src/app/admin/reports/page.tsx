import Link from "next/link";
import type { Metadata } from "next";
import {
  CircleDollarSign,
  Download,
  IndianRupee,
  Percent,
  ShoppingBag,
  Undo2,
  XCircle,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SalesChart } from "@/components/admin/sales-chart";
import { StatTile } from "@/components/admin/stat-tile";
import { formatINR, percentFromBps } from "@/lib/money";
import { firstValues } from "@/lib/search-params";
import { requireAdminPage } from "@/server/modules/auth/session";
import {
  getGstRegister,
  getSalesReport,
  istToday,
  reportRangeSchema,
  type ReportExport,
} from "@/server/modules/analytics/reports";
import { ORDER_STATUS_LABEL } from "@/server/modules/orders/order-status";
import type { OrderStatus } from "@prisma/client";

export const metadata: Metadata = { title: "Reports" };

function presets() {
  const today = istToday();
  const back = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = back(Number(today.slice(8, 10)));
  const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;
  // Indian financial year starts on 1 April.
  const fyStart = `${m >= 4 ? y : y - 1}-04-01`;
  return [
    { label: "7 days", from: back(6), to: today },
    { label: "30 days", from: back(29), to: today },
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: lastMonthStart, to: lastMonthEnd },
    { label: "Financial year", from: fyStart, to: today },
  ];
}

function ExportLink({
  report,
  from,
  to,
  label,
}: {
  report: ReportExport;
  from: string;
  to: string;
  label: string;
}) {
  return (
    <Button asChild size="sm" variant="outline">
      <a href={`/api/admin/reports/export?report=${report}&from=${from}&to=${to}`} download>
        <Download /> {label}
      </a>
    </Button>
  );
}

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  await requireAdminPage("REPORTS_VIEW");
  const range = reportRangeSchema.parse(firstValues(await searchParams));
  const [r, gst] = await Promise.all([getSalesReport(range), getGstRegister(range)]);
  const s = r.summary;
  const { from, to } = range;
  const period = `${new Date(`${from}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} – ${new Date(`${to}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <>
      <AdminPageHeader
        title="Reports"
        description="Sales, products, regions, coupons and GST from your order and invoice records. Days are in India time."
      />
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <form className="flex flex-wrap items-end gap-3" action="/admin/reports">
            <div className="grid gap-1.5">
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={from} max={to} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={to} max={istToday()} />
            </div>
            <Button type="submit">Show report</Button>
          </form>
          <nav aria-label="Quick periods" className="flex flex-wrap gap-2">
            {presets().map((p) => (
              <Link
                key={p.label}
                href={`/admin/reports?from=${p.from}&to=${p.to}`}
                aria-current={p.from === from && p.to === to ? "page" : undefined}
                className="hover:bg-accent aria-[current=page]:bg-foreground aria-[current=page]:text-background rounded-full border px-3 py-1.5 text-sm"
              >
                {p.label}
              </Link>
            ))}
          </nav>
        </CardContent>
      </Card>

      <p className="text-muted-foreground mb-3 text-sm" data-testid="report-period">
        {period} · {range.days} day{range.days === 1 ? "" : "s"}
      </p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="report-tiles">
        <StatTile
          icon={IndianRupee}
          label="Gross sales"
          value={formatINR(s.grossPaise)}
          hint={`${s.soldOrders} orders · ${s.units} units`}
        />
        <StatTile
          icon={CircleDollarSign}
          label="Net of refunds"
          value={formatINR(s.netPaise)}
          hint={`${formatINR(s.refundedPaise)} refunded (${s.refunds})`}
        />
        <StatTile
          icon={ShoppingBag}
          label="Average order value"
          value={formatINR(s.averageOrderValuePaise)}
          hint={`${s.placedOrders} orders placed`}
        />
        <StatTile
          icon={Percent}
          label="Tax collected"
          value={formatINR(s.taxPaise)}
          hint={`CGST ${formatINR(s.cgstPaise)} · SGST ${formatINR(s.sgstPaise)} · IGST ${formatINR(s.igstPaise)}`}
        />
        <StatTile
          icon={Package}
          label="Discounts given"
          value={formatINR(s.discountPaise)}
          hint={`Coupons ${formatINR(s.couponDiscountPaise)}`}
        />
        <StatTile
          icon={IndianRupee}
          label="Shipping & COD fees"
          value={formatINR(s.shippingPaise + s.codFeePaise)}
          hint={`Shipping ${formatINR(s.shippingPaise)} · COD ${formatINR(s.codFeePaise)}`}
        />
        <StatTile
          icon={XCircle}
          label="Cancelled"
          value={String(s.cancelledOrders)}
          hint={`${percentFromBps(s.cancellationRateBps)} of placed · ${s.unpaidOrders} unpaid`}
        />
        <StatTile
          icon={Undo2}
          label="Return rate"
          value={percentFromBps(s.returnRateBps)}
          hint="Sold orders with a return"
        />
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Daily sales</CardTitle>
          <ExportLink report="daily" from={from} to={to} label="CSV" />
        </CardHeader>
        <CardContent>
          <SalesChart data={r.series} />
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Orders by status</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableBody>
                {Object.entries(r.statusCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => (
                    <TableRow key={status}>
                      <TableCell className="pl-5">
                        {ORDER_STATUS_LABEL[status as OrderStatus]}
                      </TableCell>
                      <TableCell className="pr-5 text-right tabular-nums">{count}</TableCell>
                    </TableRow>
                  ))}
                {r.statusCounts && Object.keys(r.statusCounts).length === 0 && (
                  <TableRow>
                    <TableCell className="text-muted-foreground pl-5">
                      No orders in this period.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payment methods</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Method</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="pr-5 text-right">Sales</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.paymentMethods.map((m) => (
                  <TableRow key={m.method}>
                    <TableCell className="pl-5">
                      {m.method === "COD" ? "Cash on Delivery" : "Online (Razorpay)"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.orders}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">
                      {formatINR(m.totalPaise)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Products</CardTitle>
          <ExportLink report="products" from={from} to={to} label="CSV" />
        </CardHeader>
        <CardContent className="px-0">
          <Table data-testid="report-products">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="pr-5 text-right">Sales</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.products.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground pl-5">
                    No sales in this period.
                  </TableCell>
                </TableRow>
              )}
              {r.products.slice(0, 25).map((p) => (
                <TableRow key={`${p.variantId ?? p.sku}`}>
                  <TableCell className="pl-5">
                    {p.productId ? (
                      <Link href={`/admin/products/${p.productId}`} className="hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      p.name
                    )}
                    <span className="text-muted-foreground"> · {p.variant}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.units}</TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">
                    {formatINR(p.sales)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {r.products.length > 25 && (
            <p className="text-muted-foreground px-5 pt-3 text-xs">
              Top 25 shown — download the CSV for all {r.products.length}.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Categories</CardTitle>
            <ExportLink report="categories" from={from} to={to} label="CSV" />
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Category</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="pr-5 text-right">Sales</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.categories.map((c) => (
                  <TableRow key={c.category}>
                    <TableCell className="pl-5">{c.category}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.units}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">
                      {formatINR(c.sales)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Coupons</CardTitle>
            <ExportLink report="coupons" from={from} to={to} label="CSV" />
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Code</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="pr-5 text-right">Discount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.coupons.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground pl-5">
                      No coupons used.
                    </TableCell>
                  </TableRow>
                )}
                {r.coupons.map((c) => (
                  <TableRow key={c.code}>
                    <TableCell className="pl-5 font-mono text-xs">{c.code}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.uses}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">
                      {formatINR(c.discount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Sales by state</CardTitle>
          <ExportLink report="states" from={from} to={to} label="CSV" />
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">State</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                <TableHead className="pr-5 text-right">Tax (CGST+SGST / IGST)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.states.map((x) => (
                <TableRow key={x.stateCode}>
                  <TableCell className="pl-5">{x.stateName}</TableCell>
                  <TableCell className="text-right tabular-nums">{x.orders}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatINR(x.totalPaise)}
                  </TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">
                    {formatINR(x.cgstPaise + x.sgstPaise)} / {formatINR(x.igstPaise)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>GST register (invoices issued)</CardTitle>
            <p className="text-muted-foreground mt-1 text-xs">
              From the invoices&apos; stored snapshots, by invoice date. For your accountant&apos;s
              review before filing.
            </p>
          </div>
          <div className="flex gap-2">
            <ExportLink report="gst" from={from} to={to} label="Invoices CSV" />
            <ExportLink report="hsn" from={from} to={to} label="HSN CSV" />
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <Table data-testid="gst-summary">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Invoices</TableHead>
                <TableHead className="text-right">Taxable value</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead className="text-right">IGST</TableHead>
                <TableHead className="pr-5 text-right">Invoice total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="pl-5 tabular-nums">{gst.rows.length}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatINR(gst.totals.taxableValuePaise)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatINR(gst.totals.cgstPaise)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatINR(gst.totals.sgstPaise)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatINR(gst.totals.igstPaise)}
                </TableCell>
                <TableCell className="pr-5 text-right tabular-nums">
                  {formatINR(gst.totals.grandTotalPaise)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {gst.hsn.length > 0 && (
            <p className="text-muted-foreground px-5 pt-3 text-xs">
              HSN:{" "}
              {gst.hsn
                .map(
                  (h) =>
                    `${h.hsn} (${h.quantity} units, taxable ${formatINR(h.taxableValuePaise)})`,
                )
                .join(" · ")}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
