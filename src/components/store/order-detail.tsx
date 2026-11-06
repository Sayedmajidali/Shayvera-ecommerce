import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, Clock, Package, Truck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { OrderActions } from "@/components/store/order-actions";
import { stateName } from "@/lib/india";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AddressSnapshot } from "@/lib/validation/checkout";
import {
  CUSTOMER_CANCELLABLE,
  ORDER_PROGRESS,
  ORDER_STATUS_LABEL,
} from "@/server/modules/orders/order-status";
import type { orderDetailInclude } from "@/server/modules/orders/orders";
import type { Prisma } from "@prisma/client";

type Order = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

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

export function OrderDetail({
  order,
  token,
  banner,
}: {
  order: Order;
  token: string | null;
  banner?: React.ReactNode;
}) {
  const step = ORDER_PROGRESS.indexOf(order.status);
  const shipment = order.shipments[0];
  const canPay =
    order.paymentMethod === "RAZORPAY" &&
    order.status === "PENDING" &&
    order.paymentStatus !== "PAID" &&
    (!order.paymentExpiresAt || order.paymentExpiresAt > new Date());
  const canCancel = CUSTOMER_CANCELLABLE.includes(order.status);

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
          <Badge
            variant={
              order.status === "CANCELLED"
                ? "destructive"
                : order.status === "DELIVERED"
                  ? "success"
                  : order.status === "PENDING"
                    ? "warning"
                    : "brand"
            }
            data-testid="order-status"
          >
            {ORDER_STATUS_LABEL[order.status]}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {order.paymentMethod === "COD" ? "Cash on Delivery" : "Online payment"} ·{" "}
            {order.paymentStatus.replace("_", " ").toLowerCase()}
          </span>
        </div>
      </div>

      {order.status === "PENDING" && order.paymentMethod === "RAZORPAY" && (
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

      {order.status !== "CANCELLED" &&
        order.status !== "REFUNDED" &&
        order.status !== "PENDING" && (
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
                      done
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className={cn("text-xs", done ? "font-medium" : "text-muted-foreground")}>
                    {ORDER_STATUS_LABEL[s]}
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
          <p className="font-medium">Shipment</p>
          <p className="text-muted-foreground mt-1">
            {shipment.carrier}
            {shipment.trackingNumber && (
              <>
                {" "}
                · Tracking{" "}
                <span className="text-foreground font-mono">{shipment.trackingNumber}</span>
              </>
            )}
            {shipment.trackingUrl && (
              <>
                {" "}
                ·{" "}
                <a
                  href={shipment.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  Track package
                </a>
              </>
            )}
          </p>
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
            <h2 className="mb-3 font-semibold">Shipping to</h2>
            <Address a={order.shippingAddress as AddressSnapshot} />
          </div>
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
          />
        </aside>
      </div>
    </div>
  );
}
