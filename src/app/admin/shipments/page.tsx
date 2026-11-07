import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, PackageOpen, Truck, Warehouse } from "lucide-react";
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
import { shippingProviderName } from "@/lib/env";
import { firstValues } from "@/lib/search-params";
import { requireAdminPage } from "@/server/modules/auth/session";
import { getShipmentsDashboard, shipmentListSchema } from "@/server/modules/shipping/dashboard";
import { SHIPMENT_STATUS_LABEL } from "@/server/modules/shipping/status";

export const metadata: Metadata = { title: "Shipments" };

const dt = (d: Date | null) =>
  d
    ? d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export default async function ShipmentsPage({ searchParams }: PageProps<"/admin/shipments">) {
  await requireAdminPage("SHIPPING_MANAGE");
  const f = shipmentListSchema.parse(firstValues(await searchParams));
  const d = await getShipmentsDashboard(f);
  const t = d.tiles;
  const provider = shippingProviderName();
  return (
    <>
      <AdminPageHeader
        title="Shipments"
        description={
          provider === "manual"
            ? "Courier integration is off (manual mode): staff enter the courier and AWB on each order."
            : `Courier bookings through ${provider === "mock" ? "the mock courier (testing only)" : "Shiprocket"}. Tracking updates arrive by webhook and are re-checked every 30 minutes.`
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="shipment-tiles">
        <StatTile
          icon={PackageOpen}
          label="Orders to book"
          value={String(t.toBook)}
          hint="Confirmed, no courier yet"
        />
        <StatTile
          icon={Warehouse}
          label="Awaiting pickup"
          value={String(t.awaitingPickup)}
          hint="AWB assigned"
        />
        <StatTile
          icon={Truck}
          label="In transit"
          value={String(t.inTransit)}
          hint="With the courier"
        />
        <StatTile
          icon={CheckCircle2}
          label="Delivered (7 days)"
          value={String(t.delivered7d)}
          hint={`${t.attention} need attention`}
        />
      </div>

      {d.attention.length > 0 && (
        <Card className="border-destructive/40 mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="text-destructive size-4" aria-hidden /> Needs attention (
              {d.attention.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Problem</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.attention.map((s) => (
                  <TableRow key={s.id} data-testid="attention-shipment">
                    <TableCell>
                      <Link
                        href={`/admin/orders/${s.order.id}`}
                        className="font-medium hover:underline"
                      >
                        {s.order.orderNumber}
                      </Link>
                      {s.isReturn && (
                        <span className="text-muted-foreground ml-1 text-xs">(return)</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate text-xs">
                      {s.lastError ?? s.providerStatus ?? SHIPMENT_STATUS_LABEL[s.status]}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.status === "FAILED" && !s.isReturn && (
                        <RetryEventButton
                          url={`/api/admin/shipments/${s.id}/retry`}
                          label="Retry booking"
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {d.unmatched.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Courier updates not matched (30 days)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>AWB</TableHead>
                  <TableHead>Courier status</TableHead>
                  <TableHead>Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.unmatched.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm">{dt(e.receivedAt)}</TableCell>
                    <TableCell className="font-mono text-xs">{e.awb ?? "—"}</TableCell>
                    <TableCell className="text-sm">{e.status ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{e.note}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6 gap-0 py-0">
        <CardHeader className="py-4">
          <CardTitle>Shipments</CardTitle>
        </CardHeader>
        <FilterBar
          placeholder="Order number, AWB or reference"
          selects={[
            {
              name: "status",
              label: "All statuses",
              options: Object.entries(SHIPMENT_STATUS_LABEL).map(([value, label]) => ({
                value,
                label,
              })),
            },
          ]}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Courier</TableHead>
              <TableHead>AWB</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last update</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.shipments.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-8 text-center text-sm">
                  No shipments found.
                </TableCell>
              </TableRow>
            )}
            {d.shipments.map((s) => (
              <TableRow key={s.id} data-testid="shipment-row">
                <TableCell className="text-sm">{dt(s.createdAt)}</TableCell>
                <TableCell>
                  <Link
                    href={`/admin/orders/${s.order.id}`}
                    className="font-medium hover:underline"
                  >
                    {s.order.orderNumber}
                  </Link>
                  {s.isReturn && (
                    <span className="text-muted-foreground ml-1 text-xs">(return)</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">{s.carrier}</TableCell>
                <TableCell className="font-mono text-xs">{s.trackingNumber ?? "—"}</TableCell>
                <TableCell>
                  <StatusBadge status={s.status} />
                </TableCell>
                <TableCell className="text-sm">{dt(s.lastEventAt ?? s.updatedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
