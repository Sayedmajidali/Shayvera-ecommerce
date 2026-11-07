import Link from "next/link";
import type { Metadata } from "next";
import { Clock, IndianRupee, Undo2, XCircle } from "lucide-react";
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
import { StatTile } from "@/components/admin/stat-tile";
import { StatusBadge } from "@/components/admin/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { formatINR } from "@/lib/money";
import { firstValues } from "@/lib/search-params";
import { requireAdminPage } from "@/server/modules/auth/session";
import { listRequests, requestListSchema, requestStats } from "@/server/modules/orders/requests";

export const metadata: Metadata = { title: "Cancellations & returns" };

export default async function RequestsPage({ searchParams }: PageProps<"/admin/requests">) {
  await requireAdminPage("RETURNS_MANAGE");
  const raw = firstValues(await searchParams);
  const f = requestListSchema.parse(raw);
  const [{ requests, total, pageCount }, st] = await Promise.all([listRequests(f), requestStats()]);
  return (
    <>
      <AdminPageHeader
        title="Cancellations & returns"
        description="Customer requests waiting for a decision (oldest first). Open an order to approve, reject or record returned items."
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="request-tiles">
        <StatTile
          icon={XCircle}
          label="Cancellations to decide"
          value={String(st.openCancellations)}
          hint="Stock stays reserved until decided"
          tone={st.openCancellations ? "warning" : undefined}
        />
        <StatTile
          icon={Undo2}
          label="Returns to decide"
          value={String(st.openReturns)}
          hint={`${st.awaitingReceipt} approved, waiting for the parcel`}
          tone={st.openReturns ? "warning" : undefined}
        />
        <StatTile
          icon={Clock}
          label="Median decision time"
          value={st.medianDecisionHours === null ? "—" : `${st.medianDecisionHours} h`}
          hint={`${st.decided30d} decided in 30 days · ${st.rejected30d} rejected`}
        />
        <StatTile
          icon={IndianRupee}
          label="Refunded (30 days)"
          value={formatINR(st.refunds30d.paise)}
          hint={`${st.refunds30d.count} refunds completed`}
        />
      </div>
      <Card className="gap-0 py-0">
        <FilterBar
          search={false}
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
