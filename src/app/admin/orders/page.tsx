import type { Metadata } from "next";
import { ORDER_STATUS_LABEL } from "@/server/modules/orders/order-status";
import Link from "next/link";
import { AlertTriangle, ClipboardList } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { FilterBar } from "@/components/admin/filter-bar";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { formatINR } from "@/lib/money";
import { firstValues } from "@/lib/search-params";
import { adminOrderFiltersSchema, listOrdersAdmin } from "@/server/modules/orders/admin-orders";
import { requireAdminPage } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "Orders" };

const opt = (vals: string[]) =>
  vals.map((v) => ({
    value: v,
    label: v
      .replace("_", " ")
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase()),
  }));

export default async function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  // Each page authorizes itself: layouts are not re-rendered on client-side navigation.
  await requireAdminPage("ORDERS_VIEW");
  const raw = firstValues(await searchParams);
  const f = adminOrderFiltersSchema.parse(raw);
  const { orders, total, page, pageCount } = await listOrdersAdmin(f);
  return (
    <>
      <AdminPageHeader title="Orders" description="Search by order number, email or phone." />
      <Card className="gap-0 py-0">
        <FilterBar
          placeholder="Order number, email or phone"
          selects={[
            {
              name: "status",
              label: "Statuses",
              options: opt([...Object.keys(ORDER_STATUS_LABEL)]),
            },
            {
              name: "payment",
              label: "Payment states",
              options: opt(["PENDING", "PAID", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED"]),
            },
            {
              name: "method",
              label: "Methods",
              options: [
                { value: "COD", label: "Cash on Delivery" },
                { value: "RAZORPAY", label: "Razorpay" },
              ],
            },
          ]}
        />
        {orders.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={ClipboardList} title="No orders match" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link
                      href={`/admin/orders/${o.id}`}
                      className="inline-flex items-center gap-1.5 font-medium hover:underline"
                    >
                      {o.requiresAttention && (
                        <AlertTriangle
                          className="text-warning size-3.5"
                          aria-label="Needs attention"
                        />
                      )}
                      {o.orderNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {o.createdAt.toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell>
                    <p className="max-w-48 truncate">
                      {(o.shippingAddress as { fullName?: string }).fullName}
                    </p>
                    <p className="text-muted-foreground max-w-48 truncate text-xs">{o.email}</p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={o.status} />
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground text-xs">
                      {o.paymentMethod === "COD" ? "COD" : "Online"}
                    </span>{" "}
                    <StatusBadge status={o.paymentStatus} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{o._count.items}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatINR(o.totalPaise)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <AdminPagination
          page={page}
          pageCount={pageCount}
          total={total}
          basePath="/admin/orders"
          searchParams={raw}
        />
      </Card>
    </>
  );
}
