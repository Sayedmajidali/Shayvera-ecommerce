"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, PackageCheck, X } from "lucide-react";
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
};

type Item = { id: string; name: string; variant: string };

/** Staff decisions on customer cancellation / return requests for one order. */
export function OrderRequestsPanel({
  requests,
  items,
  permissions,
  paidOnline,
}: {
  requests: AdminOrderRequest[];
  items: Item[];
  permissions: string[];
  paidOnline: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AdminOrderRequest | null>(null);
  const [receiving, setReceiving] = useState<AdminOrderRequest | null>(null);
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
