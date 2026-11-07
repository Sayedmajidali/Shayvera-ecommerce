import type { ShipmentStatus } from "@prisma/client";
import { CUSTOMER_SHIPMENT_LABEL as LABEL } from "@/server/modules/shipping/status";

type TrackingShipment = {
  carrier: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: ShipmentStatus;
  etd?: Date | null;
  events: {
    id: string;
    status: ShipmentStatus | null;
    activity: string | null;
    location: string | null;
    occurredAt: Date;
  }[];
};

const when = (d: Date) =>
  d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/** Customer-safe shipment summary and courier scan history (status, place and time only). */
export function ShipmentTracking({ shipment }: { shipment: TrackingShipment }) {
  // Placeholder rows ("Pending courier") exist while the booking is in progress.
  const booked = shipment.trackingNumber !== null;
  const showEtd =
    shipment.etd && !["DELIVERED", "RTO_DELIVERED", "RETURNED"].includes(shipment.status);
  return (
    <div className="grid gap-3 text-sm" data-testid="shipment-tracking">
      <dl className="grid gap-2">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium" data-testid="shipment-status">
            {booked ? LABEL[shipment.status] : "Preparing your shipment"}
          </dd>
        </div>
        {booked && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Courier</dt>
            <dd>{shipment.carrier}</dd>
          </div>
        )}
        {shipment.trackingNumber && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Tracking no.</dt>
            <dd className="font-mono">{shipment.trackingNumber}</dd>
          </div>
        )}
        {showEtd && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Expected delivery</dt>
            <dd>
              {shipment.etd!.toLocaleDateString("en-IN", {
                timeZone: "Asia/Kolkata",
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </dd>
          </div>
        )}
      </dl>
      {shipment.trackingUrl && (
        <a
          href={shipment.trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline underline-offset-4"
        >
          Track with the courier
        </a>
      )}
      {shipment.events.length > 0 && (
        <ol className="grid gap-2 border-t pt-3" aria-label="Tracking history">
          {shipment.events.map((e, i) => (
            <li key={e.id} className="flex gap-3">
              <span
                aria-hidden
                className={`mt-1.5 size-2 shrink-0 rounded-full ${i === 0 ? "bg-brand" : "bg-border"}`}
              />
              <span>
                <span className={i === 0 ? "font-medium" : ""}>
                  {e.status ? LABEL[e.status] : e.activity}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {[e.location, when(e.occurredAt)].filter(Boolean).join(" · ")}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
