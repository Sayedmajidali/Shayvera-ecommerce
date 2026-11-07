import Link from "next/link";
import type { Metadata } from "next";
import { FileWarning } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatINR } from "@/lib/money";
import { firstValues } from "@/lib/search-params";
import { hasPermission } from "@/server/modules/auth/permissions";
import { requireAdminPage } from "@/server/modules/auth/session";
import { invoiceListSchema, listInvoices } from "@/server/modules/invoices/invoices";

export const metadata: Metadata = { title: "Invoices" };

const date = (d: Date | null) =>
  d ? d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" }) : "—";

export default async function InvoicesPage({ searchParams }: PageProps<"/admin/invoices">) {
  const admin = await requireAdminPage("ORDERS_VIEW");
  const sp = firstValues(await searchParams);
  const f = invoiceListSchema.parse(sp);
  const d = await listInvoices(f);
  return (
    <>
      <AdminPageHeader
        title="Invoices"
        description="Issued invoices and credit notes are immutable snapshots, numbered per financial year. A credit note is issued automatically when an invoiced order is refunded."
      />
      {d.uninvoiced.length > 0 && (
        <Card className="border-warning/50 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileWarning className="size-4" aria-hidden /> Delivered orders without an invoice (
              {d.uninvoiced.length}
              {d.uninvoiced.length === 20 ? "+" : ""})
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm" data-testid="uninvoiced">
            {d.uninvoiced.map((o) => (
              <Link
                key={o.id}
                href={`/admin/orders/${o.id}`}
                className="hover:bg-accent rounded-full border px-3 py-1"
              >
                {o.orderNumber} · {formatINR(o.totalPaise)}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-row items-center justify-between gap-2 py-4">
          <CardTitle>{d.total} invoices</CardTitle>
          {hasPermission(admin.permissions, "REPORTS_VIEW") && (
            <Link
              href="/admin/reports"
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              GST register in Reports →
            </Link>
          )}
        </CardHeader>
        <FilterBar
          placeholder="Invoice or order number"
          selects={[
            {
              name: "fy",
              label: "Financial years",
              options: d.years.map((y) => ({ value: y, label: `FY ${y}` })),
            },
          ]}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Place of supply</TableHead>
              <TableHead className="text-right">Tax</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.invoices.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground py-8 text-center text-sm">
                  No invoices found.
                </TableCell>
              </TableRow>
            )}
            {d.invoices.map((i) => (
              <TableRow key={i.id} data-testid="invoice-row">
                <TableCell>
                  <a
                    href={`/invoice/${i.order.orderNumber}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs font-medium hover:underline"
                  >
                    {i.invoiceNumber}
                  </a>
                  <span className="text-muted-foreground block text-xs">{i.documentTitle}</span>
                </TableCell>
                <TableCell className="text-sm">{date(i.issuedAt)}</TableCell>
                <TableCell>
                  <Link href={`/admin/orders/${i.order.id}`} className="hover:underline">
                    {i.order.orderNumber}
                  </Link>
                  <StatusBadge status={i.order.status} className="ml-2" />
                </TableCell>
                <TableCell className="max-w-40 truncate text-sm">{i.buyerName}</TableCell>
                <TableCell className="text-sm">{i.placeOfSupply}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(i.taxPaise)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatINR(i.grandTotalPaise)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="p-4">
          <AdminPagination
            page={f.page}
            pageCount={d.pageCount}
            total={d.total}
            basePath="/admin/invoices"
            searchParams={sp}
          />
        </div>
      </Card>
      {d.creditNotes.length > 0 && (
        <Card className="mt-6 gap-0 py-0">
          <CardHeader className="py-4">
            <CardTitle>Recent credit notes</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Credit note</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Against invoice</TableHead>
                <TableHead>Order</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.creditNotes.map((c) => (
                <TableRow key={c.id} data-testid="credit-note-row">
                  <TableCell>
                    <a
                      href={`/credit-note/${c.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs font-medium hover:underline"
                    >
                      {c.number}
                    </a>
                  </TableCell>
                  <TableCell className="text-sm">{date(c.issuedAt)}</TableCell>
                  <TableCell className="font-mono text-xs">{c.invoice.invoiceNumber}</TableCell>
                  <TableCell>
                    <Link href={`/admin/orders/${c.order.id}`} className="hover:underline">
                      {c.order.orderNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatINR(c.amountPaise)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
