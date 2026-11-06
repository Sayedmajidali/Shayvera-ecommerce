import Link from "next/link";
import type { Metadata } from "next";
import { Undo2 } from "lucide-react";
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
import { requireAdminPage } from "@/server/modules/auth/session";
import { listRequests, requestListSchema } from "@/server/modules/orders/requests";

export const metadata: Metadata = { title: "Cancellations & returns" };

export default async function RequestsPage({ searchParams }: PageProps<"/admin/requests">) {
  await requireAdminPage("RETURNS_MANAGE");
  const raw = firstValues(await searchParams);
  const f = requestListSchema.parse(raw);
  const { requests, total, pageCount } = await listRequests(f);
  return (
    <>
      <AdminPageHeader
        title="Cancellations & returns"
        description="Customer requests waiting for a decision (oldest first). Open an order to approve, reject or record returned items."
      />
      <Card className="gap-0 py-0">
        <FilterBar
          placeholder="(filters only)"
          selects={[
            {
              name: "status",
              label: "Open requests",
              options: ["PENDING", "APPROVED", "REJECTED", "COMPLETED", "WITHDRAWN"].map((s) => ({
                value: s,
                label: s.charAt(0) + s.slice(1).toLowerCase(),
              })),
            },
            {
              name: "type",
              label: "All types",
              options: [
                { value: "CANCELLATION", label: "Cancellations" },
                { value: "RETURN", label: "Returns" },
              ],
            },
          ]}
        />
        {requests.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Undo2}
              title="Nothing waiting"
              description="New requests appear here."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id} data-testid="request-row">
                  <TableCell>
                    <Link
                      href={`/admin/orders/${r.order.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.order.orderNumber}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {r.order.paymentMethod === "COD" ? "COD" : "Online"} ·{" "}
                      {r.order.paymentStatus.toLowerCase()}
                    </p>
                  </TableCell>
                  <TableCell>{r.type === "CANCELLATION" ? "Cancellation" : "Return"}</TableCell>
                  <TableCell className="max-w-xs truncate">{r.reason}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {r.createdAt.toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatINR(r.order.totalPaise)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <AdminPagination
          page={f.page}
          pageCount={pageCount}
          total={total}
          basePath="/admin/requests"
          searchParams={raw}
        />
      </Card>
    </>
  );
}
