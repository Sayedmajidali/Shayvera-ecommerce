"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CalendarClock,
  FileText,
  Loader2,
  PackagePlus,
  RefreshCw,
  RotateCcw,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { StatusBadge } from "@/components/admin/status-badge";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { formatINR } from "@/lib/money";

export type PanelShipment = {
  id: string;
  isReturn: boolean;
  provider: string;
  status: string;
  statusLabel: string;
  carrier: string;
  reference: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  manifestUrl: string | null;
  pickupScheduledAt: string | null;
  etd: string | null;
  lastError: string | null;
  needsAttention: boolean;
  weightGrams: number | null;
  events: {
    id: string;
    activity: string | null;
    location: string | null;
    occurredAt: string;
    providerStatus: string | null;
  }[];
};

type Quote = {
  courierId: string;
  name: string;
  ratePaise: number | null;
  cod: boolean;
  etaDays: number | null;
};
type Quotes = {
  parcel: {
    weightGrams: number;
    lengthMm: number;
    breadthMm: number;
    heightMm: number;
    usedDefaults: boolean;
  };
  couriers: Quote[];
  recommendedCourierId: string | null;
  available: boolean;
};

const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

const CANCELLABLE = [
  "PENDING",
  "CREATING",
  "CREATED",
  "AWB_ASSIGNED",
  "PICKUP_SCHEDULED",
  "FAILED",
];
const BOOKABLE_ORDER = ["CONFIRMED", "PROCESSING", "READY_TO_SHIP"];

/** Courier shipments for one order: book, pickup, documents, tracking, cancel, retry. */
export function ShippingPanel({
  orderId,
  orderStatus,
  shipments,
  canManage,
  providerName,
}: {
  orderId: string;
  orderStatus: string;
  shipments: PanelShipment[];
  canManage: boolean;
  providerName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  const [quotes, setQuotes] = useState<Quotes | null>(null);
  const [courierId, setCourierId] = useState<string>("");
  const [parcel, setParcel] = useState({
    weightGrams: "",
    lengthMm: "",
    breadthMm: "",
    heightMm: "",
  });
  const [pickupFor, setPickupFor] = useState<PanelShipment | null>(null);
  const [pickupDate, setPickupDate] = useState("");

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
      setBookOpen(false);
      setPickupFor(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const openBooking = async () => {
    setBookOpen(true);
    setQuotes(null);
    try {
      const q = await apiFetch<Quotes>(`/api/admin/orders/${orderId}/courier-quotes`);
      setQuotes(q);
      setCourierId(q.recommendedCourierId ?? q.couriers[0]?.courierId ?? "");
      setParcel({
        weightGrams: String(q.parcel.weightGrams),
        lengthMm: String(q.parcel.lengthMm),
        breadthMm: String(q.parcel.breadthMm),
        heightMm: String(q.parcel.heightMm),
      });
    } catch {
      toast.error("Could not load courier options");
    }
  };

  const openDoc = async (s: PanelShipment, kind: "label" | "manifest") => {
    setBusy(`${kind}-${s.id}`);
    try {
      const { url } = await apiFetch<{ url: string }>(
        `/api/admin/shipments/${s.id}/document?kind=${kind}`,
      );
      window.open(url, "_blank", "noopener,noreferrer");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : `Could not get the ${kind}`);
    } finally {
      setBusy(null);
    }
  };

  const active = shipments.find((s) => !s.isReturn && !["CANCELLED", "FAILED"].includes(s.status));
  const canBook =
    canManage && providerName !== "manual" && !active && BOOKABLE_ORDER.includes(orderStatus);

  return (
    <div className="grid gap-4" data-testid="shipping-panel">
      {shipments.length === 0 && <p className="text-muted-foreground text-sm">No shipment yet.</p>}
      {shipments.map((s) => (
        <div key={s.id} className="rounded-xl border p-4 text-sm" data-testid="shipment">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              {s.isReturn ? "Return pickup · " : ""}
              {s.carrier}
            </p>
            <StatusBadge status={s.status} />
          </div>
          <p className="text-muted-foreground mt-1 text-xs">{s.statusLabel}</p>
          <dl className="mt-2 grid gap-1 text-xs">
            {s.trackingNumber && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">AWB</dt>
                <dd className="font-mono" data-testid="awb">
                  {s.trackingNumber}
                </dd>
              </div>
            )}
            {s.reference && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Reference</dt>
                <dd className="font-mono">{s.reference}</dd>
              </div>
            )}
            {s.pickupScheduledAt && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Pickup</dt>
                <dd>{dt(s.pickupScheduledAt)}</dd>
              </div>
            )}
            {s.etd && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Expected</dt>
                <dd>{dt(s.etd)}</dd>
              </div>
            )}
          </dl>
          {s.lastError && (
            <p className="bg-destructive-soft text-destructive mt-2 rounded-md p-2 text-xs">
              {s.lastError}
            </p>
          )}
          {canManage && s.provider !== "manual" && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {s.status === "FAILED" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    run(
                      `retry-${s.id}`,
                      () => apiFetch(`/api/admin/shipments/${s.id}/retry`, { body: {} }),
                      "Booking retried",
                    )
                  }
                >
                  <RotateCcw /> Retry booking
                </Button>
              )}
              {s.trackingNumber && !s.isReturn && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => openDoc(s, "label")}
                  >
                    <FileText /> Label
                  </Button>
                  {["AWB_ASSIGNED", "PICKUP_SCHEDULED"].includes(s.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => {
                        setPickupFor(s);
                        setPickupDate("");
                      }}
                    >
                      <CalendarClock />{" "}
                      {s.status === "PICKUP_SCHEDULED" ? "Reschedule pickup" : "Schedule pickup"}
                    </Button>
                  )}
                  {s.status === "PICKUP_SCHEDULED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => openDoc(s, "manifest")}
                    >
                      <FileText /> Manifest
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() =>
                      run(
                        `refresh-${s.id}`,
                        () => apiFetch(`/api/admin/shipments/${s.id}/refresh`, { body: {} }),
                        "Tracking updated",
                      )
                    }
                  >
                    <RefreshCw /> Refresh
                  </Button>
                </>
              )}
              {CANCELLABLE.includes(s.status) && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => {
                    const reason = window.prompt("Why are you cancelling this courier booking?");
                    if (reason && reason.trim().length >= 3)
                      void run(
                        `cancel-${s.id}`,
                        () => apiFetch(`/api/admin/shipments/${s.id}/cancel`, { body: { reason } }),
                        "Booking cancelled",
                      );
                  }}
                >
                  <Ban /> Cancel booking
                </Button>
              )}
            </div>
          )}
          {s.events.length > 0 && (
            <ol
              className="text-muted-foreground mt-3 grid gap-1 border-t pt-3 text-xs"
              aria-label="Tracking history"
            >
              {s.events.map((e) => (
                <li key={e.id}>
                  <span className="text-foreground">{e.activity ?? e.providerStatus}</span>
                  {e.location ? ` · ${e.location}` : ""} · {dt(e.occurredAt)}
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
      {canBook && (
        <Button onClick={openBooking}>
          <PackagePlus /> Book courier
        </Button>
      )}

      <Dialog open={bookOpen} onOpenChange={setBookOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Book courier</DialogTitle>
            <DialogDescription>
              The parcel is booked with the courier and an AWB and label are created. Courier rates
              are what the store pays.
            </DialogDescription>
          </DialogHeader>
          {!quotes ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading courier options…
            </p>
          ) : (
            <div className="grid gap-4">
              {quotes.couriers.length > 0 ? (
                <RadioGroup
                  value={courierId}
                  onValueChange={setCourierId}
                  className="grid gap-2"
                  aria-label="Courier"
                >
                  {quotes.couriers.map((c) => (
                    <Label
                      key={c.courierId}
                      htmlFor={`c-${c.courierId}`}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 font-normal"
                    >
                      <RadioGroupItem id={`c-${c.courierId}`} value={c.courierId} />
                      <span className="flex-1">
                        {c.name}
                        {c.courierId === quotes.recommendedCourierId && (
                          <span className="text-brand ml-2 text-xs">Recommended</span>
                        )}
                        <span className="text-muted-foreground block text-xs">
                          {c.etaDays ? `~${c.etaDays} days` : "ETA n/a"} ·{" "}
                          {c.cod ? "COD" : "Prepaid only"}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {c.ratePaise !== null ? formatINR(c.ratePaise) : "—"}
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {quotes.available
                    ? "No courier serves this PIN for this order."
                    : "Courier options are unavailable right now; the courier will pick the recommended service."}
                </p>
              )}
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">
                  Parcel{" "}
                  {quotes.parcel.usedDefaults && (
                    <span className="text-muted-foreground text-xs">
                      (estimated from defaults — check it)
                    </span>
                  )}
                </legend>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(["weightGrams", "lengthMm", "breadthMm", "heightMm"] as const).map((k) => (
                    <div key={k} className="grid gap-1">
                      <Label htmlFor={`p-${k}`} className="text-xs">
                        {
                          {
                            weightGrams: "Weight (g)",
                            lengthMm: "Length (mm)",
                            breadthMm: "Breadth (mm)",
                            heightMm: "Height (mm)",
                          }[k]
                        }
                      </Label>
                      <Input
                        id={`p-${k}`}
                        type="number"
                        min={1}
                        value={parcel[k]}
                        onChange={(e) => setParcel({ ...parcel, [k]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </fieldset>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setBookOpen(false)}>
                  Close
                </Button>
                <Button
                  disabled={busy !== null || (quotes.available && quotes.couriers.length === 0)}
                  onClick={() =>
                    run(
                      "book",
                      () =>
                        apiFetch(`/api/admin/orders/${orderId}/book-shipment`, {
                          body: {
                            courierId: courierId || null,
                            weightGrams: Number(parcel.weightGrams) || undefined,
                            lengthMm: Number(parcel.lengthMm) || undefined,
                            breadthMm: Number(parcel.breadthMm) || undefined,
                            heightMm: Number(parcel.heightMm) || undefined,
                          },
                        }),
                      "Booking queued — the AWB appears in a moment",
                    )
                  }
                >
                  <Truck /> Book shipment
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={pickupFor !== null} onOpenChange={(o) => !o && setPickupFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule pickup</DialogTitle>
            <DialogDescription>
              Leave the date empty for the next available pickup. Sundays and holidays move to the
              next working day.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="pickup-date">Pickup date (optional)</Label>
            <Input
              id="pickup-date"
              type="date"
              value={pickupDate}
              onChange={(e) => setPickupDate(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPickupFor(null)}>
              Close
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() =>
                pickupFor &&
                run(
                  "pickup",
                  () =>
                    apiFetch(`/api/admin/shipments/${pickupFor.id}/pickup`, {
                      body: { date: pickupDate || null },
                    }),
                  "Pickup scheduled",
                )
              }
            >
              Schedule pickup
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
