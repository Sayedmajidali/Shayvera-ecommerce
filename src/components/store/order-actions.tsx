"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { usePayment, type PaymentSession } from "@/components/store/use-payment";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

export function OrderActions({
  orderNumber,
  token,
  canPay,
  canCancel,
}: {
  orderNumber: string;
  token: string | null;
  canPay: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const { pay, dialog } = usePayment();
  const [paying, setPaying] = useState(false);
  if (!canPay && !canCancel) return null;
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
          description="Items will be released. If you’ve already paid online, a full refund will be issued to your original payment method."
          confirmLabel="Cancel order"
          onConfirm={async () => {
            try {
              await apiFetch(`/api/orders/${orderNumber}/cancel`, { body: { token } });
              toast.success("Order cancelled");
              router.refresh();
            } catch (err) {
              toast.error(err instanceof ApiClientError ? err.message : "Could not cancel order");
            }
          }}
          trigger={
            <Button variant="outline">
              <XCircle /> Cancel order
            </Button>
          }
        />
      )}
    </div>
  );
}
