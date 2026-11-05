"use client";

import { useCallback, useRef, useState } from "react";
import { CreditCard, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/fetcher";
import { formatINR } from "@/lib/money";

export type PaymentSession = {
  keyId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: "INR";
  orderNumber: string;
  gateway: "razorpay" | "mock";
  prefill: { name: string; email: string; contact: string };
};

export type PaymentOutcome = "paid" | "failed" | "dismissed" | "pending";

type CheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};
type VerifyResult = { outcome: string; status: string; paymentStatus: string };

type RazorpayInstance = {
  open: () => void;
  on: (
    ev: string,
    cb: (r: {
      error?: { code?: string; description?: string; metadata?: { payment_id?: string } };
    }) => void,
  ) => void;
};
declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => RazorpayInstance;
  }
}

function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () =>
      reject(new Error("Could not load the payment window. Check your connection."));
    document.body.appendChild(s);
  });
}

async function verify(resp: CheckoutResponse): Promise<PaymentOutcome> {
  const r = await apiFetch<VerifyResult>("/api/payments/razorpay/verify", { body: resp });
  if (r.paymentStatus === "PAID") return "paid";
  if (r.outcome === "failed") return "failed";
  return "pending";
}

/**
 * Opens Razorpay Checkout (or the offline simulator when the server runs the mock gateway) and
 * resolves once the server has verified the result. The browser's success callback alone never
 * marks an order paid — `/api/payments/razorpay/verify` does, after checking the signature and
 * fetching the payment from the gateway.
 */
export function usePayment() {
  const [mock, setMock] = useState<PaymentSession | null>(null);
  const [mockBusy, setMockBusy] = useState(false);
  const resolver = useRef<((o: PaymentOutcome) => void) | null>(null);

  const pay = useCallback(async (session: PaymentSession): Promise<PaymentOutcome> => {
    if (session.gateway === "mock") {
      return new Promise<PaymentOutcome>((resolve) => {
        resolver.current = resolve;
        setMock(session);
      });
    }
    await loadCheckoutScript();
    return new Promise<PaymentOutcome>((resolve) => {
      let settled = false;
      const done = (o: PaymentOutcome) => {
        if (!settled) {
          settled = true;
          resolve(o);
        }
      };
      const rzp = new window.Razorpay!({
        key: session.keyId,
        amount: session.amountPaise,
        currency: session.currency,
        order_id: session.razorpayOrderId,
        name: "Shayvera",
        description: `Order ${session.orderNumber}`,
        prefill: session.prefill,
        theme: { color: "#2a2520" },
        retry: { enabled: true, max_count: 3 },
        handler: async (resp: CheckoutResponse) => {
          try {
            done(await verify(resp));
          } catch {
            done("pending");
          }
        },
        modal: { ondismiss: () => done("dismissed"), confirm_close: true },
      });
      rzp.on("payment.failed", (r) => {
        void apiFetch("/api/payments/razorpay/failure", {
          body: {
            razorpay_order_id: session.razorpayOrderId,
            razorpay_payment_id: r.error?.metadata?.payment_id,
            code: r.error?.code,
            description: r.error?.description,
          },
        }).catch(() => undefined);
      });
      rzp.open();
    });
  }, []);

  const finishMock = async (outcome: "captured" | "failed" | "dismissed") => {
    const session = mock;
    if (!session) return;
    let result: PaymentOutcome = "dismissed";
    if (outcome !== "dismissed") {
      setMockBusy(true);
      try {
        const resp = await apiFetch<CheckoutResponse>("/api/payments/mock/complete", {
          body: { razorpayOrderId: session.razorpayOrderId, outcome },
        });
        result = await verify(resp);
      } catch {
        result = "failed";
      } finally {
        setMockBusy(false);
      }
    }
    setMock(null);
    resolver.current?.(result);
    resolver.current = null;
  };

  const dialog = (
    <Dialog open={mock !== null} onOpenChange={(o) => !o && !mockBusy && finishMock("dismissed")}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="size-5" /> Test payment
          </DialogTitle>
          <DialogDescription>
            Offline payment simulator (PAYMENT_GATEWAY=mock). No real money moves. The result is
            signed and verified by the server exactly like a Razorpay payment.
          </DialogDescription>
        </DialogHeader>
        {mock && (
          <div className="bg-muted rounded-xl p-4 text-sm">
            <p>
              Order <span className="font-medium">{mock.orderNumber}</span>
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {formatINR(mock.amountPaise)}
            </p>
          </div>
        )}
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <ShieldAlert className="size-4" /> Development only — disabled in production.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={mockBusy} onClick={() => finishMock("dismissed")}>
            Close
          </Button>
          <Button variant="outline" disabled={mockBusy} onClick={() => finishMock("failed")}>
            Simulate failure
          </Button>
          <Button disabled={mockBusy} onClick={() => finishMock("captured")}>
            {mockBusy && <Loader2 className="animate-spin" />} Pay{" "}
            {mock ? formatINR(mock.amountPaise) : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { pay, dialog };
}
