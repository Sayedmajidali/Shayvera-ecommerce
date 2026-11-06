"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2, PackageX, Undo2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ConfirmButton } from "@/components/admin/confirm-button";
import { FieldError } from "@/components/shared/field-error";
import { usePayment, type PaymentSession } from "@/components/store/use-payment";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

export type ReturnableItem = { id: string; name: string; variant: string; quantity: number };

export function OrderActions({
  orderNumber,
  token,
  canPay,
  canCancel,
  canRequestCancel = false,
  returnable = [],
  returnDeadline = null,
  pendingRequestId = null,
}: {
  orderNumber: string;
  token: string | null;
  canPay: boolean;
  /** Unpaid order: cancel immediately. */
  canCancel: boolean;
  /** Accepted order before handover: ask staff to cancel. */
  canRequestCancel?: boolean;
  /** Delivered items that can be returned (empty when returns are not possible). */
  returnable?: ReturnableItem[];
  returnDeadline?: string | null;
  /** A pending request the customer can withdraw. */
  pendingRequestId?: string | null;
}) {
  const router = useRouter();
  const { pay, dialog } = usePayment();
  const [paying, setPaying] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const call = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      toast.success(success);
      setCancelOpen(false);
      setReturnOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(err instanceof ApiClientError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const canReturn = returnable.length > 0;
  if (!canPay && !canCancel && !canRequestCancel && !canReturn && !pendingRequestId) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {dialog}
      {canPay && (
        <Button
          disabled={paying}
          onClick={async () => {
            setPaying(true);
            try {
              const session = await apiFetch<PaymentSession>(`/api/orders/${orderNumber}/pay`, {
                body: { token },
              });
              const outcome = await pay(session);
              if (outcome === "paid") toast.success("Payment received — your order is confirmed");
              else if (outcome === "failed")
                toast.error("Payment failed. Please try again or use another method.");
              router.refresh();
            } catch (err) {
              toast.error(err instanceof ApiClientError ? err.message : "Could not start payment");
              router.refresh();
            } finally {
              setPaying(false);
            }
          }}
        >
          {paying ? <Loader2 className="animate-spin" /> : <CreditCard />} Complete payment
        </Button>
      )}
      {canCancel && (
        <ConfirmButton
          title="Cancel this order?"
          description="The items will be released. Nothing has been charged for this order."
          confirmLabel="Cancel order"
          onConfirm={() =>
            call(
              () => apiFetch(`/api/orders/${orderNumber}/cancel`, { body: { token } }),
              "Order cancelled",
            )
          }
          trigger={
            <Button variant="outline">
              <XCircle /> Cancel order
            </Button>
          }
        />
      )}
      {canRequestCancel && (
        <Button variant="outline" onClick={() => setCancelOpen(true)}>
          <XCircle /> Request cancellation
        </Button>
      )}
      {canReturn && (
        <Button variant="outline" onClick={() => setReturnOpen(true)}>
          <PackageX /> Request a return
        </Button>
      )}
      {pendingRequestId && (
        <ConfirmButton
          title="Withdraw your request?"
          description="Your order will continue as before."
          confirmLabel="Withdraw request"
          destructive={false}
          onConfirm={() =>
            call(
              () =>
                apiFetch(`/api/orders/${orderNumber}/requests/${pendingRequestId}/withdraw`, {
                  body: { token },
                }),
              "Request withdrawn",
            )
          }
          trigger={
            <Button variant="ghost">
              <Undo2 /> Withdraw request
            </Button>
          }
        />
      )}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request cancellation</DialogTitle>
            <DialogDescription>
              Your order is already being prepared, so our team will review the request and email
              you. If you paid online, a full refund is issued once it’s approved.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="cancel-reason">Reason (optional)</Label>
            <Textarea
              id="cancel-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. ordered by mistake, delivery address changed"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              Keep order
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                call(
                  () => apiFetch(`/api/orders/${orderNumber}/cancel`, { body: { token, reason } }),
                  "Cancellation requested — we’ll email you shortly",
                )
              }
            >
              {busy && <Loader2 className="animate-spin" />} Send request
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Request a return</DialogTitle>
            <DialogDescription>
              Choose the items and tell us what went wrong (damaged, leaking, wrong item…).
              {returnDeadline ? ` Requests are accepted until ${returnDeadline}.` : ""}
            </DialogDescription>
          </DialogHeader>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">Items</legend>
            {returnable.map((i) => {
              const selected = (qty[i.id] ?? 0) > 0;
              return (
                <div key={i.id} className="flex items-center gap-3 text-sm">
                  <Checkbox
                    id={`ret-${i.id}`}
                    checked={selected}
                    onCheckedChange={(v) => setQty((q) => ({ ...q, [i.id]: v === true ? 1 : 0 }))}
                  />
                  <Label htmlFor={`ret-${i.id}`} className="flex-1 font-normal">
                    {i.name} <span className="text-muted-foreground">· {i.variant}</span>
                  </Label>
                  {i.quantity > 1 && selected && (
                    <Input
                      type="number"
                      min={1}
                      max={i.quantity}
                      aria-label={`Quantity of ${i.name} to return`}
                      className="w-20"
                      value={qty[i.id]}
                      onChange={(e) =>
                        setQty((q) => ({
                          ...q,
                          [i.id]: Math.min(i.quantity, Math.max(1, Number(e.target.value) || 1)),
                        }))
                      }
                    />
                  )}
                </div>
              );
            })}
            <FieldError message={errors.lines} />
          </fieldset>
          <div className="grid gap-2">
            <Label htmlFor="return-reason">What went wrong?</Label>
            <Textarea
              id="return-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={!!errors.reason}
            />
            <FieldError message={errors.reason} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReturnOpen(false)}>
              Close
            </Button>
            <Button
              disabled={busy || !Object.values(qty).some((n) => n > 0)}
              onClick={() =>
                call(
                  () =>
                    apiFetch(`/api/orders/${orderNumber}/return`, {
                      body: {
                        token,
                        reason,
                        lines: Object.entries(qty)
                          .filter(([, n]) => n > 0)
                          .map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
                      },
                    }),
                  "Return requested — we’ll email you the next steps",
                )
              }
            >
              {busy && <Loader2 className="animate-spin" />} Send return request
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
