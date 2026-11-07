import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, CircleX, IndianRupee, TrendingUp, Undo2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FilterBar } from "@/components/admin/filter-bar";
import { AdminPageHeader } from "@/components/admin/page-header";
import { RetryEventButton } from "@/components/admin/retry-event-button";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatINR } from "@/lib/money";
import { firstValues } from "@/lib/search-params";
import { hasPermission } from "@/server/modules/auth/permissions";
import { requireAdminPage } from "@/server/modules/auth/session";
import { getPaymentsDashboard, paymentListSchema } from "@/server/modules/payments/dashboard";

export const metadata: Metadata = { title: "Payments" };

const dt = (d: Date | null) =>
  d
    ? d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export default async function PaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  const admin = await requireAdminPage("PAYMENTS_VIEW");
  const f = paymentListSchema.parse(firstValues(await searchParams));
  const d = await getPaymentsDashboard(f);
  const t = d.tiles;
  const canRetry = hasPermission(admin.permissions, ["PAYMENTS_VIEW", "ORDERS_MANAGE"]);
  return (
    <>
      <AdminPageHeader
        title="Payments"
        description="Online payments, refunds and Razorpay webhooks. Amounts are confirmed with Razorpay before an order is marked paid."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="payment-tiles">
        <StatTile
          icon={IndianRupee}
          label="Captured today"
          value={formatINR(t.capturedToday.paise)}
          hint={`${t.capturedToday.count} payments`}
        />
        <StatTile
          icon={TrendingUp}
          label="Captured (7 days)"
          value={formatINR(t.captured7d.paise)}
          hint={`${t.captured7d.count} payments`}
        />
        <StatTile
          icon={CircleX}
          label="Failed attempts (7 days)"
          value={String(t.failed7d)}
          hint={`${t.awaitingPayment} orders awaiting payment`}
        />
        <StatTile
          icon={Undo2}
          label="Refunds in progress"
          value={formatINR(t.refundsPending.paise)}
          hint={`${t.refundsPending.count} pending · ${formatINR(t.refunded30d.paise)} refunded in 30 days`}
        />
      </div>

      {d.eventQueue.length > 0 && (
        <Card className="border-destructive/40 mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="text-destructive size-4" aria-hidden /> Webhooks not
              processed ({t.stuckEvents})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Last error</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.eventQueue.map((e) => (
                  <TableRow key={e.id} data-testid="stuck-event">
                    <TableCell className="text-sm">{dt(e.receivedAt)}</TableCell>
                    <TableCell className="font-mono text-xs">{e.eventType}</TableCell>
                    <TableCell>
                      {e.order ? (
                        <Link href={`/admin/orders/${e.order.id}`} className="hover:underline">
                          {e.order.orderNumber}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate text-xs">
                      {e.processingError ?? "Waiting for the worker"}
                    </TableCell>
                    <TableCell className="text-right">
                      {canRetry && <RetryEventButton eventId={e.id} />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {d.refundQueue.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Refunds needing a look</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.refundQueue.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{dt(r.createdAt)}</TableCell>
                    <TableCell>
                      <Link href={`/admin/orders/${r.order.id}`} className="hover:underline">
                        {r.order.orderNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate text-xs">
                      {r.status === "PENDING"
                        ? r.razorpayRefundId
                          ? "Processing at Razorpay"
                          : "Confirming with Razorpay"
                        : (r.failureReason ?? "")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatINR(r.amountPaise)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6 gap-0 py-0">
        <CardHeader className="py-4">
          <CardTitle>Recent payments</CardTitle>
        </CardHeader>
        <FilterBar
          placeholder="Order number or Razorpay id"
          selects={[
            {
              name: "status",
              label: "All statuses",
              options: [
                "CREATED",
                "AUTHORIZED",
                "CAPTURED",
                "FAILED",
                "REFUNDED",
                "PARTIALLY_REFUNDED",
              ].map((s) => ({
                value: s,
                label: (s.charAt(0) + s.slice(1).toLowerCase()).replace(/_/g, " "),
              })),
            },
            {
              name: "method",
              label: "All methods",
              options: [
                { value: "RAZORPAY", label: "Online" },
                { value: "COD", label: "COD" },
              ],
            },
          ]}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Razorpay payment</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.payments.map((p) => (
              <TableRow key={p.id} data-testid="payment-row">
                <TableCell className="text-sm">{dt(p.createdAt)}</TableCell>
                <TableCell>
                  <Link
                    href={`/admin/orders/${p.order.id}`}
                    className="font-medium hover:underline"
                  >
                    {p.order.orderNumber}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">
                  {p.method === "COD" ? "COD" : (p.instrument ?? "Online").toUpperCase()}
                </TableCell>
                <TableCell>
                  <StatusBadge status={p.status} />
                  {p.errorDescription && (
                    <p className="text-muted-foreground mt-1 max-w-[16rem] truncate text-xs">
                      {p.errorDescription}
                    </p>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{p.razorpayPaymentId ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatINR(p.amountPaise)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
