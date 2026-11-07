import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, Clock, Package, Truck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { OrderActions } from "@/components/store/order-actions";
import { OrderTimeline } from "@/components/store/order-timeline";
import { stateName } from "@/lib/india";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AddressSnapshot } from "@/lib/validation/checkout";
import {
  AWAITING_PAYMENT,
  CANCELLATION_REQUESTABLE,
  CUSTOMER_CANCELLABLE,
  ORDER_PROGRESS,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  progressStep,
} from "@/server/modules/orders/order-status";
import { returnDeadline } from "@/server/modules/orders/requests";
import { ShipmentTracking } from "@/components/store/shipment-tracking";
import type { orderDetailInclude } from "@/server/modules/orders/orders";
import type { Prisma } from "@prisma/client";

type Order = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

const REFUND_LABEL = {
  PENDING: "Processing",
  PROCESSED: "Refunded",
  FAILED: "Not completed — our team will contact you",
} as const;

const fmtDate = (d: Date) =>
  d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function Address({ a }: { a: AddressSnapshot }) {
  return (
    <p className="text-muted-foreground text-sm leading-6">
      <span className="text-foreground font-medium">{a.fullName}</span>
      <br />
      {a.line1}
      {a.line2 && `, ${a.line2}`}
      {a.landmark && `, near ${a.landmark}`}
      <br />
      {a.city}, {stateName(a.stateCode)} {a.pincode}
      <br />
      {a.phone}
    </p>
  );
}

export async function OrderDetail({
  order,
  token,
  banner,
}: {
  order: Order;
  token: string | null;
  banner?: React.ReactNode;
}) {
  const step = progressStep(order.status);
  const shipment = order.shipments[0];
  const awaitingPayment = AWAITING_PAYMENT.includes(order.status);
  const canPay =
    order.paymentMethod === "RAZORPAY" &&
    awaitingPayment &&
    order.paymentStatus !== "PAID" &&
    (!order.paymentExpiresAt || order.paymentExpiresAt > new Date());
  const canCancel = CUSTOMER_CANCELLABLE.includes(order.status);
  const canRequestCancel = CANCELLATION_REQUESTABLE.includes(order.status);
  const deadline = order.status === "DELIVERED" ? await returnDeadline(order.deliveredAt) : null;
  const canReturn = deadline !== null && deadline > new Date();
  const latestRequest = order.requests[0];
  const openRequest =
    latestRequest && (latestRequest.status === "PENDING" || latestRequest.status === "APPROVED")
      ? latestRequest
      : null;

  return (
    <div className="grid gap-6">
      {banner}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">Order</p>
          <h1 className="heading-display text-3xl sm:text-4xl" data-testid="order-number">
            {order.orderNumber}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Placed {fmtDate(order.placedAt)}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant={ORDER_STATUS_TONE[order.status]} data-testid="order-status">
            {ORDER_STATUS_LABEL[order.status]}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {order.paymentMethod === "COD" ? "Cash on Delivery" : "Online payment"} ·{" "}
            {order.paymentStatus.replace("_", " ").toLowerCase()}
          </span>
        </div>
      </div>

      {awaitingPayment && order.paymentMethod === "RAZORPAY" && (
        <div className="border-warning/40 bg-warning-soft flex items-start gap-3 rounded-2xl border p-4 text-sm">
          <Clock className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">
              {order.paymentStatus === "FAILED"
                ? "Your last payment attempt failed."
                : "We’re waiting for your payment."}
            </p>
            <p className="text-muted-foreground">
              {order.paymentExpiresAt
                ? `Items are reserved until ${fmtDate(order.paymentExpiresAt)}. `
                : ""}
              If money was deducted, it will be confirmed automatically within a few minutes.
            </p>
          </div>
        </div>
      )}

      {openRequest && (
        <div
          className="border-warning/40 bg-warning-soft rounded-2xl border p-4 text-sm"
          data-testid="order-request"
        >
          <p className="font-medium">
            {openRequest.type === "CANCELLATION"
              ? "Cancellation requested — our team is reviewing it."
              : openRequest.status === "APPROVED"
                ? "Return approved — please send the items back as described in our email."
                : "Return requested — our team is reviewing it."}
          </p>
          <p className="text-muted-foreground mt-1">Your reason: {openRequest.reason}</p>
          {openRequest.resolutionNote && (
            <p className="text-muted-foreground mt-1">Our note: {openRequest.resolutionNote}</p>
          )}
        </div>
      )}
      {latestRequest?.status === "REJECTED" && !openRequest && (
        <p className="bg-muted rounded-2xl p-4 text-sm" data-testid="order-request">
          Your {latestRequest.type === "CANCELLATION" ? "cancellation" : "return"} request wasn’t
          approved{latestRequest.resolutionNote ? `: ${latestRequest.resolutionNote}` : "."}
        </p>
      )}

      {step !== null && (
        <ol
          className="bg-card grid grid-cols-4 gap-2 rounded-2xl border p-5"
          aria-label="Order progress"
        >
          {ORDER_PROGRESS.map((s, i) => {
            const Icon = [CheckCircle2, Package, Truck, CheckCircle2][i]!;
            const done = i <= step;
            return (
              <li key={s} className="flex flex-col items-center gap-2 text-center">
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full",
                    done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className={cn("text-xs", done ? "font-medium" : "text-muted-foreground")}>
                  {s}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {order.status === "CANCELLED" && (
        <p className="bg-destructive-soft text-destructive flex items-center gap-2 rounded-2xl border p-4 text-sm">
          <XCircle className="size-4" /> This order was cancelled
          {order.cancelReason ? ` — ${order.cancelReason}` : ""}.
        </p>
      )}

      {shipment && (
        <div className="bg-card rounded-2xl border p-5 text-sm">
          <p className="mb-3 font-medium">Shipment</p>
          <ShipmentTracking shipment={shipment} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="bg-card rounded-2xl border">
          <h2 className="border-b px-5 py-4 font-semibold">Items</h2>
          <ul className="divide-y">
            {order.items.map((i) => (
              <li key={i.id} className="flex gap-4 p-5">
                <div className="bg-muted relative h-20 w-16 shrink-0 overflow-hidden rounded-lg">
                  {i.imageUrl && (
                    <Image src={i.imageUrl} alt="" fill sizes="64px" className="object-cover" />
                  )}
                </div>
                <div className="flex-1 text-sm">
                  <Link href={`/product/${i.productSlug}`} className="font-medium hover:underline">
                    {i.productName}
                  </Link>
                  <p className="text-muted-foreground">
                    {i.variantName} · Qty {i.quantity}
                  </p>
                  <p className="text-muted-foreground">{formatINR(i.unitPricePaise)} each</p>
                </div>
                <p className="text-sm font-medium tabular-nums">{formatINR(i.lineTotalPaise)}</p>
              </li>
            ))}
          </ul>
        </section>
        <aside className="grid h-fit gap-6">
          <div className="bg-card rounded-2xl border p-5">
            <h2 className="mb-4 font-semibold">Payment summary</h2>
            <dl className="grid gap-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{formatINR(order.subtotalPaise)}</dd>
              </div>
              {order.couponDiscountPaise > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Coupon ({order.couponCode})</dt>
                  <dd className="text-success tabular-nums">
                    −{formatINR(order.couponDiscountPaise)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Shipping</dt>
                <dd className="tabular-nums">
                  {order.shippingPaise ? formatINR(order.shippingPaise) : "Free"}
                </dd>
              </div>
              {order.codFeePaise > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">COD fee</dt>
                  <dd className="tabular-nums">{formatINR(order.codFeePaise)}</dd>
                </div>
              )}
              {order.taxPaise > 0 && !order.pricesIncludeTax && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">GST</dt>
                  <dd className="tabular-nums">{formatINR(order.taxPaise)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t pt-2.5 font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatINR(order.totalPaise)}</dd>
              </div>
              {order.taxPaise > 0 && order.pricesIncludeTax && (
                <p className="text-muted-foreground text-xs">
                  Includes GST {formatINR(order.taxPaise)}
                </p>
              )}
              {order.refundedPaise > 0 && (
                <div className="text-success flex justify-between">
                  <dt>Refunded</dt>
                  <dd className="tabular-nums">{formatINR(order.refundedPaise)}</dd>
                </div>
              )}
            </dl>
          </div>
          <div className="bg-card rounded-2xl border p-5">
            <h2 className="mb-4 font-semibold">History</h2>
            <OrderTimeline history={order.statusHistory} />
          </div>
          <div className="bg-card rounded-2xl border p-5">
            <h2 className="mb-3 font-semibold">Shipping to</h2>
            <Address a={order.shippingAddress as AddressSnapshot} />
          </div>
          {order.refunds.length > 0 && (
            <div className="bg-card rounded-2xl border p-5 text-sm" data-testid="refunds">
              <h2 className="mb-3 font-semibold">Refunds</h2>
              <ul className="grid gap-3">
                {order.refunds.map((r) => (
                  <li key={r.id} className="grid gap-0.5">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium tabular-nums">{formatINR(r.amountPaise)}</span>
                      <span
                        className={
                          r.status === "PROCESSED"
                            ? "text-success"
                            : r.status === "FAILED"
                              ? "text-destructive"
                              : "text-muted-foreground"
                        }
                      >
                        {REFUND_LABEL[r.status]}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {(r.processedAt ?? r.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        timeZone: "Asia/Kolkata",
                      })}
                      {" · "}
                      {r.method === "RAZORPAY"
                        ? "to your original payment method (5–7 business days)"
                        : "by bank transfer/UPI from our team"}
                      {r.razorpayRefundId ? ` · Ref. ${r.razorpayRefundId}` : ""}
                    </span>
                    {r.creditNote && (
                      <a
                        href={`/credit-note/${r.creditNote.id}${token ? `?t=${encodeURIComponent(token)}` : ""}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline underline-offset-4"
                      >
                        Credit note {r.creditNote.number}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {order.invoice && (
            <a
              href={`/invoice/${order.orderNumber}${token ? `?t=${encodeURIComponent(token)}` : ""}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium underline underline-offset-4"
            >
              Download invoice {order.invoice.invoiceNumber}
            </a>
          )}
          <OrderActions
            orderNumber={order.orderNumber}
            token={token}
            canPay={canPay}
            canCancel={canCancel}
            canRequestCancel={canRequestCancel && !openRequest}
            returnable={
              canReturn && !openRequest
                ? order.items.map((i) => ({
                    id: i.id,
                    name: i.productName,
                    variant: i.variantName,
                    quantity: i.quantity,
                  }))
                : []
            }
            returnDeadline={
              deadline?.toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
                timeZone: "Asia/Kolkata",
              }) ?? null
            }
            pendingRequestId={openRequest?.status === "PENDING" ? openRequest.id : null}
          />
        </aside>
      </div>
    </div>
  );
}
