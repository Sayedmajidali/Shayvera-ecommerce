"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, FileText, Loader2, RefreshCw, RotateCcw, Truck } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { FieldError } from "@/components/shared/field-error";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { formatINR, rupeesToPaise } from "@/lib/money";

type Props = {
  orderId: string;
  orderNumber: string;
  status: string;
  allowed: string[];
  paymentMethod: "COD" | "RAZORPAY";
  paymentStatus: string;
  refundablePaise: number;
  hasInvoice: boolean;
  requiresAttention: boolean;
  /** Whether the order's status allows a tax invoice. */
  invoiceable: boolean;
  /** Manual shipping: staff type courier + AWB. Otherwise shipments are booked in the Shipping panel. */
  manualShipping: boolean;
  /** The viewer's admin permissions; controls are hidden when the server would refuse them. */
  permissions: string[];
};

const CARRIERS = [
  "Delhivery",
  "Blue Dart",
  "DTDC",
  "Ekart",
  "India Post",
  "Xpressbees",
  "Shadowfax",
  "Other",
];

export function OrderAdminActions(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [statusTo, setStatusTo] = useState<string>("");
  const [note, setNote] = useState("");
  const [ship, setShip] = useState({
    carrier: "Delhivery",
    trackingNumber: "",
    trackingUrl: "",
    notes: "",
  });
  const [refund, setRefund] = useState({
    amount: (p.refundablePaise / 100).toFixed(2),
    reason: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setErrors({});
    try {
      await fn();
      toast.success(success);
      router.refresh();
      return true;
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(err instanceof ApiClientError ? err.message : "Action failed");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const can = (perm: string) => p.permissions.includes(perm);
  const paidOnline = p.paymentMethod === "RAZORPAY" && p.paymentStatus === "PAID";
  const requestDriven: string[] = [
    "PAYMENT_FAILED",
    "CANCELLATION_REQUESTED",
    "RETURN_REQUESTED",
    "RETURNED",
    "REFUND_PENDING",
    "REFUNDED",
  ];
  // Orders with an open request, or whose status follows a refund, are handled elsewhere.
  const locked = requestDriven.includes(p.status) && p.status !== "PAYMENT_FAILED";
  const transitions =
    can("ORDERS_MANAGE") && !locked
      ? p.allowed.filter(
          (s) =>
            !requestDriven.includes(s) &&
            !(s === "CONFIRMED" && p.paymentMethod === "RAZORPAY") &&
            !(s === "CANCELLED" && paidOnline && !can("PAYMENTS_REFUND")) &&
            !(s === "SHIPPED" && !can("SHIPPING_MANAGE")),
        )
      : [];

  return (
    <div className="grid gap-4">
      {transitions.length > 0 && (
        <div className="grid gap-2">
          <Label htmlFor="status-to">Update status</Label>
          <div className="flex gap-2">
            <Select value={statusTo} onValueChange={setStatusTo}>
              <SelectTrigger id="status-to" className="flex-1">
                <SelectValue placeholder="Choose next status" />
              </SelectTrigger>
              <SelectContent>
                {transitions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {(s.charAt(0) + s.slice(1).toLowerCase()).replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional, shown in history)"
            rows={2}
            maxLength={300}
          />
          {statusTo === "CANCELLED" ? (
            <ConfirmButton
              title="Cancel this order?"
              description={`Stock will be released.${p.paymentMethod === "RAZORPAY" && p.paymentStatus === "PAID" ? " The customer will be refunded in full automatically." : ""}`}
              confirmLabel="Cancel order"
              onConfirm={() =>
                run(
                  "status",
                  () =>
                    apiFetch(`/api/admin/orders/${p.orderId}/status`, {
                      body: { status: statusTo, note },
                    }),
                  "Order cancelled",
                ).then(() => setStatusTo(""))
              }
              trigger={
                <Button variant="destructive" disabled={busy !== null}>
                  Cancel order
                </Button>
              }
            />
          ) : statusTo === "SHIPPED" ? (
            <Button onClick={() => setShipOpen(true)}>
              <Truck /> Add shipment & mark shipped
            </Button>
          ) : (
            <Button
              disabled={!statusTo || busy !== null}
              onClick={() =>
                run(
                  "status",
                  () =>
                    apiFetch(`/api/admin/orders/${p.orderId}/status`, {
                      body: { status: statusTo, note },
                    }),
                  "Status updated",
                ).then((ok) => ok && (setStatusTo(""), setNote("")))
              }
            >
              {busy === "status" ? <Loader2 className="animate-spin" /> : <CheckCheck />} Update
              status
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {can("SHIPPING_MANAGE") &&
          p.manualShipping &&
          ["CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "OUT_FOR_DELIVERY"].includes(
            p.status,
          ) && (
            <Button variant="outline" size="sm" onClick={() => setShipOpen(true)}>
              <Truck /> Add tracking
            </Button>
          )}
        {can("PAYMENTS_REFUND") &&
          (p.paymentStatus === "PAID" || p.paymentStatus === "PARTIALLY_REFUNDED") &&
          p.refundablePaise > 0 && (
            <Button variant="outline" size="sm" onClick={() => setRefundOpen(true)}>
              <RotateCcw /> Refund
            </Button>
          )}
        {can("ORDERS_MANAGE") &&
          p.paymentMethod === "RAZORPAY" &&
          (p.status === "PENDING" || p.status === "PAYMENT_FAILED") && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "reconcile",
                  () =>
                    apiFetch(`/api/admin/orders/${p.orderId}/reconcile`, {
                      method: "POST",
                      body: {},
                    }),
                  "Payment status refreshed from Razorpay",
                )
              }
            >
              <RefreshCw /> Check payment status
            </Button>
          )}
        {p.invoiceable &&
          (p.hasInvoice ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/invoice/${p.orderNumber}`} target="_blank" rel="noreferrer">
                <FileText /> View invoice
              </a>
            </Button>
          ) : can("ORDERS_MANAGE") ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "invoice",
                  () =>
                    apiFetch(`/api/admin/orders/${p.orderId}/invoice`, {
                      method: "POST",
                      body: {},
                    }),
                  "Invoice issued",
                )
              }
            >
              <FileText /> Generate invoice
            </Button>
          ) : null)}
        {can("ORDERS_MANAGE") && p.requiresAttention && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              run(
                "attention",
                () => apiFetch(`/api/admin/orders/${p.orderId}/attention`, { method: "DELETE" }),
                "Marked as resolved",
              )
            }
          >
            Mark attention resolved
          </Button>
        )}
      </div>

      <Dialog open={shipOpen} onOpenChange={setShipOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Shipment details</DialogTitle>
            <DialogDescription>
              The customer will be emailed the tracking details.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(
                "ship",
                () =>
                  apiFetch(`/api/admin/orders/${p.orderId}/shipments`, {
                    body: { ...ship, markShipped: true },
                  }),
                "Shipment saved",
              );
              if (ok) {
                setShipOpen(false);
                setStatusTo("");
              }
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="carrier">Carrier</Label>
              <Select value={ship.carrier} onValueChange={(v) => setShip({ ...ship, carrier: v })}>
                <SelectTrigger id="carrier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CARRIERS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="awb">Tracking / AWB number</Label>
              <Input
                id="awb"
                value={ship.trackingNumber}
                onChange={(e) => setShip({ ...ship, trackingNumber: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="turl">Tracking link (optional)</Label>
              <Input
                id="turl"
                type="url"
                value={ship.trackingUrl}
                onChange={(e) => setShip({ ...ship, trackingUrl: e.target.value })}
                placeholder="https://"
                aria-invalid={!!errors.trackingUrl}
              />
              <FieldError message={errors.trackingUrl} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShipOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy !== null}>
                {busy === "ship" && <Loader2 className="animate-spin" />} Save shipment
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue refund</DialogTitle>
            <DialogDescription>
              Up to {formatINR(p.refundablePaise)} can be refunded.{" "}
              {p.paymentMethod === "RAZORPAY"
                ? "The refund is sent to the original payment method via Razorpay."
                : "COD refunds are recorded as manual (bank transfer/UPI) refunds."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              let amountPaise: number;
              try {
                amountPaise = rupeesToPaise(refund.amount);
              } catch {
                setErrors({ amountPaise: "Enter a valid amount" });
                return;
              }
              const ok = await run(
                "refund",
                () =>
                  apiFetch(`/api/admin/orders/${p.orderId}/refunds`, {
                    body: { amountPaise, reason: refund.reason },
                  }),
                "Refund issued",
              );
              if (ok) setRefundOpen(false);
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="ramount">Amount (₹)</Label>
              <Input
                id="ramount"
                inputMode="decimal"
                value={refund.amount}
                onChange={(e) => setRefund({ ...refund, amount: e.target.value })}
                aria-invalid={!!errors.amountPaise}
              />
              <FieldError message={errors.amountPaise} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rreason">Reason</Label>
              <Input
                id="rreason"
                value={refund.reason}
                onChange={(e) => setRefund({ ...refund, reason: e.target.value })}
                aria-invalid={!!errors.reason}
              />
              <FieldError message={errors.reason} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setRefundOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={busy !== null}>
                {busy === "refund" && <Loader2 className="animate-spin" />} Refund
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
