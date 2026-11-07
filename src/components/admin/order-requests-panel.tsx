"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, IndianRupee, Loader2, PackageCheck, Truck, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { formatINR, paiseToRupeesString, rupeesToPaise } from "@/lib/money";
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
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/admin/status-badge";
import { FieldError } from "@/components/shared/field-error";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

export type AdminOrderRequest = {
  id: string;
  type: "CANCELLATION" | "RETURN";
  status: string;
  reason: string;
  lines: { orderItemId: string; quantity: number }[] | null;
  resolutionNote: string | null;
  createdAt: string;
  /** The live (not failed) refund that settles this return, if any. */
  refund?: { status: string; amountPaise: number } | null;
};

type RefundQuote = {
  items: { orderItemId: string; name: string; quantity: number; valuePaise: number }[];
  itemsPaise: number;
  shippingPaise: number;
  remainingPaise: number;
  paid: boolean;
};

type Item = { id: string; name: string; variant: string };

/** Staff decisions on customer cancellation / return requests for one order. */
export function OrderRequestsPanel({
  requests,
  items,
  permissions,
  paidOnline,
  courierReturns = false,
  returnPickupBooked = false,
}: {
  requests: AdminOrderRequest[];
  items: Item[];
  permissions: string[];
  paidOnline: boolean;
  /** A courier integration is configured, so a reverse pickup can be booked. */
  courierReturns?: boolean;
  /** An active return pickup already exists for this order. */
  returnPickupBooked?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AdminOrderRequest | null>(null);
  const [receiving, setReceiving] = useState<AdminOrderRequest | null>(null);
  const [refunding, setRefunding] = useState<AdminOrderRequest | null>(null);
  const [quote, setQuote] = useState<RefundQuote | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [withShipping, setWithShipping] = useState(false);
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState<Record<string, { received: string; restock: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const can = (p: string) => permissions.includes(p);
  const itemName = (id: string) => {
    const i = items.find((x) => x.id === id);
    return i ? `${i.name} · ${i.variant}` : "Item";
  };

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setErrors({});
    try {
      const result = (await fn()) as
        { shipmentToCancel?: boolean; refundStarted?: boolean } | undefined;
      toast.success(success);
      if (result?.refundStarted) toast.info("A full refund has been started.");
      if (result?.shipmentToCancel)
        toast.warning("This order has a shipment record — cancel it with the courier.");
      setRejecting(null);
      setReceiving(null);
      setRefunding(null);
      setNote("");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(err instanceof ApiClientError ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  if (requests.length === 0) return null;
  const canDecide = can("RETURNS_MANAGE");

  return (
    <div className="grid gap-4" data-testid="order-requests">
      {requests.map((r) => (
        <div key={r.id} className="rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              {r.type === "CANCELLATION" ? "Cancellation request" : "Return request"}
            </p>
            <StatusBadge status={r.status} />
          </div>
          <p className="text-muted-foreground mt-1">
            {new Date(r.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · “
            {r.reason}”
          </p>
          {r.lines && (
            <ul className="mt-2 list-inside list-disc">
              {r.lines.map((l) => (
                <li key={l.orderItemId}>
                  {itemName(l.orderItemId)} × {l.quantity}
                </li>
              ))}
            </ul>
          )}
          {r.resolutionNote && (
            <p className="text-muted-foreground mt-2">Note: {r.resolutionNote}</p>
          )}
          {canDecide && r.status === "PENDING" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={
                  busy !== null ||
                  (r.type === "CANCELLATION" && paidOnline && !can("PAYMENTS_REFUND"))
                }
                onClick={() =>
                  run(
                    `approve-${r.id}`,
                    () => apiFetch(`/api/admin/requests/${r.id}/approve`, { body: {} }),
                    r.type === "CANCELLATION" ? "Order cancelled" : "Return approved",
                  )
                }
              >
                {busy === `approve-${r.id}` ? <Loader2 className="animate-spin" /> : <Check />}
                {r.type === "CANCELLATION"
                  ? paidOnline
                    ? "Approve & refund"
                    : "Approve cancellation"
                  : "Approve return"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => setRejecting(r)}
              >
                <X /> Reject
              </Button>
            </div>
          )}
          {r.type === "RETURN" && r.status === "COMPLETED" && (
            <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="return-refund">
              {r.refund ? (
                <p className="text-sm">
                  Refund {formatINR(r.refund.amountPaise)} ·{" "}
                  <StatusBadge status={r.refund.status} />
                </p>
              ) : (
                canDecide &&
                can("PAYMENTS_REFUND") && (
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={async () => {
                      setRefunding(r);
                      setQuote(null);
                      setWithShipping(false);
                      try {
                        const q = await apiFetch<RefundQuote>(`/api/admin/requests/${r.id}/refund`);
                        setQuote(q);
                        setRefundAmount(
                          paiseToRupeesString(Math.min(q.itemsPaise, q.remainingPaise)),
                        );
                      } catch {
                        toast.error("Could not load the return value");
                        setRefunding(null);
                      }
                    }}
                  >
                    <IndianRupee /> Refund return
                  </Button>
                )
              )}
            </div>
          )}
          {canDecide && r.type === "RETURN" && r.status === "APPROVED" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setReceipt(
                    Object.fromEntries(
                      (r.lines ?? []).map((l) => [
                        l.orderItemId,
                        { received: String(l.quantity), restock: "0" },
                      ]),
                    ),
                  );
                  setReceiving(r);
                }}
              >
                <PackageCheck /> Mark items received
              </Button>
              {courierReturns && !returnPickupBooked && can("SHIPPING_MANAGE") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    run(
                      `pickup-${r.id}`,
                      () => apiFetch(`/api/admin/requests/${r.id}/return-pickup`, { body: {} }),
                      "Return pickup booked with the courier",
                    )
                  }
                >
                  {busy === `pickup-${r.id}` ? <Loader2 className="animate-spin" /> : <Truck />}
                  Book return pickup
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => setRejecting(r)}
              >
                <X /> Reject
              </Button>
            </div>
          )}
        </div>
      ))}

      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject request</DialogTitle>
            <DialogDescription>The customer receives this reason by email.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reject-note">Reason</Label>
            <Textarea
              id="reject-note"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={!!errors.note}
            />
            <FieldError message={errors.note} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() =>
                rejecting &&
                run(
                  `reject-${rejecting.id}`,
                  () => apiFetch(`/api/admin/requests/${rejecting.id}/reject`, { body: { note } }),
                  "Request rejected",
                )
              }
            >
              Reject request
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={refunding !== null} onOpenChange={(o) => !o && setRefunding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund return</DialogTitle>
            <DialogDescription>
              Received items at the price paid. Refund less after a deduction if needed — never
              more. Online payments go back through Razorpay; COD refunds are recorded as paid
              manually (bank/UPI). A credit note is issued if the order has an invoice.
            </DialogDescription>
          </DialogHeader>
          {!quote ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          ) : !quote.paid ? (
            <p className="text-sm">
              This order has no recorded payment, so there is nothing to refund.
            </p>
          ) : (
            <div className="grid gap-4 text-sm">
              <ul className="grid gap-1">
                {quote.items.map((i) => (
                  <li key={i.orderItemId} className="flex justify-between gap-3">
                    <span>
                      {i.name} × {i.quantity}
                    </span>
                    <span className="tabular-nums">{formatINR(i.valuePaise)}</span>
                  </li>
                ))}
              </ul>
              {quote.shippingPaise > 0 && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="refund-shipping"
                    checked={withShipping}
                    onCheckedChange={(v) => {
                      const on = v === true;
                      setWithShipping(on);
                      setRefundAmount(
                        paiseToRupeesString(
                          Math.min(
                            quote.itemsPaise + (on ? quote.shippingPaise : 0),
                            quote.remainingPaise,
                          ),
                        ),
                      );
                    }}
                  />
                  <Label htmlFor="refund-shipping" className="font-normal">
                    Also refund shipping & COD fees ({formatINR(quote.shippingPaise)})
                  </Label>
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="refund-amount">Amount (₹)</Label>
                <Input
                  id="refund-amount"
                  inputMode="decimal"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  aria-invalid={!!errors.amountPaise}
                />
                <FieldError message={errors.amountPaise} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="refund-note">Note (optional)</Label>
                <Textarea
                  id="refund-note"
                  rows={2}
                  maxLength={300}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. one pouch deducted: opened"
                />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRefunding(null)}>
              Back
            </Button>
            <Button
              disabled={busy !== null || !quote?.paid}
              onClick={() => {
                if (!refunding) return;
                let amountPaise: number;
                try {
                  amountPaise = rupeesToPaise(refundAmount);
                } catch {
                  setErrors({ amountPaise: "Enter an amount like 499.50" });
                  return;
                }
                void run(
                  `refund-${refunding.id}`,
                  () =>
                    apiFetch(`/api/admin/requests/${refunding.id}/refund`, {
                      body: { amountPaise, includeShipping: withShipping, note },
                    }),
                  "Refund started",
                );
              }}
            >
              Refund {refundAmount ? `₹${refundAmount}` : ""}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={receiving !== null} onOpenChange={(o) => !o && setReceiving(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Returned items received</DialogTitle>
            <DialogDescription>
              Record what arrived. Only restock items that can be sold again — food that was opened,
              damaged or past its best should not be restocked. Refunds are issued separately.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {(receiving?.lines ?? []).map((l) => {
              const v = receipt[l.orderItemId] ?? { received: "0", restock: "0" };
              const set = (patch: Partial<typeof v>) =>
                setReceipt((r) => ({ ...r, [l.orderItemId]: { ...v, ...patch } }));
              return (
                <div key={l.orderItemId} className="grid gap-2 text-sm">
                  <p className="font-medium">
                    {itemName(l.orderItemId)}{" "}
                    <span className="text-muted-foreground">(requested {l.quantity})</span>
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1">
                      <Label htmlFor={`rcv-${l.orderItemId}`} className="text-xs">
                        Received
                      </Label>
                      <Input
                        id={`rcv-${l.orderItemId}`}
                        type="number"
                        min={0}
                        max={l.quantity}
                        value={v.received}
                        onChange={(e) => set({ received: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`rst-${l.orderItemId}`} className="text-xs">
                        Restock (sellable)
                      </Label>
                      <Input
                        id={`rst-${l.orderItemId}`}
                        type="number"
                        min={0}
                        max={Number(v.received) || 0}
                        value={v.restock}
                        disabled={!can("INVENTORY_MANAGE")}
                        onChange={(e) => set({ restock: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <FieldError message={errors.lines} />
            <div className="grid gap-2">
              <Label htmlFor="rcv-note">Note (optional)</Label>
              <Textarea
                id="rcv-note"
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReceiving(null)}>
              Back
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() =>
                receiving &&
                run(
                  `receive-${receiving.id}`,
                  () =>
                    apiFetch(`/api/admin/requests/${receiving.id}/receive`, {
                      body: {
                        note,
                        lines: Object.entries(receipt).map(([orderItemId, v]) => ({
                          orderItemId,
                          receivedQuantity: Number(v.received) || 0,
                          restockQuantity: Number(v.restock) || 0,
                        })),
                      },
                    }),
                  "Return recorded",
                )
              }
            >
              Save receipt
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
