import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { OrderDetail } from "@/components/store/order-detail";
import { firstValues } from "@/lib/search-params";
import { getCurrentUser } from "@/server/auth/session";
import { resolveOrderForRequester } from "@/server/services/order-actions";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };

/** Order confirmation / status page for both signed-in customers and guests with an access token. */
export default async function OrderPage({
  params,
  searchParams,
}: PageProps<"/order/[orderNumber]">) {
  const { orderNumber } = await params;
  const sp = firstValues(await searchParams);
  const user = await getCurrentUser();
  const token = sp.t ?? null;
  const order = await resolveOrderForRequester(orderNumber, {
    userId: user?.id ?? null,
    token,
  }).catch(() => null);
  if (!order) notFound();
  const placed = sp.placed === "1" && order.status !== "PENDING";
  return (
    <div className="container-page max-w-5xl py-10">
      <OrderDetail
        order={order}
        token={token}
        banner={
          placed ? (
            <div
              className="border-success/30 bg-success-soft flex items-start gap-3 rounded-2xl border p-5"
              role="status"
            >
              <CheckCircle2 className="text-success size-6 shrink-0" />
              <div>
                <p className="font-semibold">Thank you! Your order is confirmed.</p>
                <p className="text-muted-foreground text-sm">
                  A confirmation has been sent to {order.email}.
                </p>
              </div>
            </div>
          ) : sp.payment === "failed" ? (
            <p
              role="alert"
              className="bg-destructive-soft text-destructive rounded-2xl p-4 text-sm"
            >
              Your payment didn’t go through. You can try again below.
            </p>
          ) : null
        }
      />
    </div>
  );
}
