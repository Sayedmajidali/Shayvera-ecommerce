import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CustomerStatusToggle } from "@/components/admin/customer-status-toggle";
import { StatusBadge } from "@/components/admin/status-badge";
import { stateName } from "@/lib/india";
import { formatINR } from "@/lib/money";
import { getCustomer } from "@/server/modules/customers/admin-customers";
import { requireAdminPage } from "@/server/modules/auth/session";
import { SOLD_STATUSES } from "@/server/modules/orders/order-status";
import { isPlaceholderEmail } from "@/lib/india";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: PageProps<"/admin/customers/[id]">) {
  // Each page authorizes itself: layouts are not re-rendered on client-side navigation.
  await requireAdminPage("CUSTOMERS_VIEW");
  const { id } = await params;
  const c = await getCustomer(id).catch(() => null);
  if (!c) notFound();
  const spent = c.orders
    .filter((o) => SOLD_STATUSES.includes(o.status))
    .reduce((s, o) => s + o.totalPaise, 0);
  return (
    <>
      <Link
        href="/admin/customers"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Customers
      </Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="heading-display text-[2rem] leading-tight font-normal">
            {c.name} <StatusBadge status={c.status} className="ml-2 align-middle" />
          </h1>
          <p className="text-muted-foreground text-sm">
            {isPlaceholderEmail(c.email) ? "Mobile sign-in (no email)" : c.email}
            {c.phone ? ` · ${c.phone}` : ""} · joined {c.createdAt.toLocaleDateString("en-IN")} ·{" "}
            {c.sessions.length} active session(s)
          </p>
        </div>
        <CustomerStatusToggle id={c.id} status={c.status} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card className="gap-0 py-0">
          <CardHeader className="py-4">
            <CardTitle>
              Orders ({c.orders.length}) · {formatINR(spent)} spent
            </CardTitle>
          </CardHeader>
          {c.orders.length === 0 ? (
            <p className="text-muted-foreground px-5 pb-5 text-sm">No orders yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="pr-5 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="pl-5">
                      <Link href={`/admin/orders/${o.id}`} className="font-medium hover:underline">
                        {o.orderNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {o.createdAt.toLocaleDateString("en-IN")}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={o.status} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={o.paymentStatus} />
                    </TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">
                      {formatINR(o.totalPaise)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Addresses</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            {c.addresses.length === 0 && (
              <p className="text-muted-foreground">No saved addresses.</p>
            )}
            {c.addresses.map((a) => (
              <p key={a.id} className="leading-6">
                {a.fullName}
                {a.isDefault && <span className="text-brand ml-2 text-xs">Default</span>}
                <br />
                <span className="text-muted-foreground">
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ""}, {a.city}, {stateName(a.stateCode)} {a.pincode} ·{" "}
                  {a.phone}
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
