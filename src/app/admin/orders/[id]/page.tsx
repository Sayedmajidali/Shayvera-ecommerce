import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrderAdminActions } from "@/components/admin/order-admin-actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { stateName } from "@/lib/india";
import { formatINR } from "@/lib/money";
import type { AddressSnapshot } from "@/lib/validation/checkout";
import { getOrderAdmin } from "@/server/modules/orders/admin-orders";
import { ORDER_TRANSITIONS } from "@/server/modules/orders/order-status";
import { requireAdminPage } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "Order" };

const dt = (d: Date) =>
  d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function Addr({ a, title }: { a: AddressSnapshot; title: string }) {
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        {title}
      </p>
      <p className="text-sm leading-6">
        {a.fullName}
        <br />
        {a.line1}
        {a.line2 ? `, ${a.line2}` : ""}
        {a.landmark ? `, near ${a.landmark}` : ""}
        <br />
        {a.city}, {stateName(a.stateCode)} {a.pincode}
        <br />
        {a.phone}
      </p>
    </div>
  );
}

export default async function AdminOrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  // Each page authorizes itself: layouts are not re-rendered on client-side navigation.
  await requireAdminPage();
  const { id } = await params;
  const order = await getOrderAdmin(id).catch(() => null);
  if (!order) notFound();
  const row = "flex justify-between gap-4";
  return (
    <>
      <Link
        href="/admin/orders"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Orders
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{order.orderNumber}</h1>
        <StatusBadge status={order.status} />
        <StatusBadge status={order.paymentStatus} />
        <span className="text-muted-foreground text-sm">placed {dt(order.placedAt)}</span>
      </div>
      {order.requiresAttention && (
        <p className="border-warning/50 bg-warning-soft mb-6 flex items-center gap-2 rounded-xl border p-4 text-sm">
          <AlertTriangle className="size-4" /> Needs attention: {order.attentionReason}
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-6">
          <Card className="gap-0 py-0">
            <CardHeader className="py-4">
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <ul className="divide-y border-t">
              {order.items.map((i) => (
                <li key={i.id} className="flex gap-4 px-5 py-4 text-sm">
                  <div className="bg-muted relative h-16 w-13 shrink-0 overflow-hidden rounded-md">
                    {i.imageUrl && (
                      <Image src={i.imageUrl} alt="" fill sizes="52px" className="object-cover" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{i.productName}</p>
                    <p className="text-muted-foreground">
                      {i.variantName} · SKU {i.sku}
                      {i.hsnCode ? ` · HSN ${i.hsnCode}` : ""}
                    </p>
                    <p className="text-muted-foreground">
                      {formatINR(i.unitPricePaise)} × {i.quantity}
                      {i.discountPaise ? ` · discount ${formatINR(i.discountPaise)}` : ""}
                      {i.taxPaise ? ` · GST ${i.taxRateBps / 100}% ${formatINR(i.taxPaise)}` : ""}
                    </p>
                  </div>
                  <p className="font-medium tabular-nums">{formatINR(i.lineTotalPaise)}</p>
                </li>
              ))}
            </ul>
            <dl className="grid gap-2 border-t px-5 py-4 text-sm">
              <div className={row}>
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">{formatINR(order.subtotalPaise)}</dd>
              </div>
              {order.couponDiscountPaise > 0 && (
                <div className={row}>
                  <dt className="text-muted-foreground">Coupon {order.couponCode}</dt>
                  <dd className="tabular-nums">−{formatINR(order.couponDiscountPaise)}</dd>
                </div>
              )}
              <div className={row}>
                <dt className="text-muted-foreground">Shipping</dt>
                <dd className="tabular-nums">{formatINR(order.shippingPaise)}</dd>
              </div>
              {order.codFeePaise > 0 && (
                <div className={row}>
                  <dt className="text-muted-foreground">COD fee</dt>
                  <dd className="tabular-nums">{formatINR(order.codFeePaise)}</dd>
                </div>
              )}
              {order.taxPaise > 0 && (
                <div className={row}>
                  <dt className="text-muted-foreground">
                    GST {order.pricesIncludeTax ? "(included)" : ""}{" "}
                    {order.igstPaise
                      ? `IGST ${formatINR(order.igstPaise)}`
                      : `CGST ${formatINR(order.cgstPaise)} + SGST ${formatINR(order.sgstPaise)}`}
                  </dt>
                  <dd className="tabular-nums">{formatINR(order.taxPaise)}</dd>
                </div>
              )}
              <div className={`${row} border-t pt-2 font-semibold`}>
                <dt>Total</dt>
                <dd className="tabular-nums">{formatINR(order.totalPaise)}</dd>
              </div>
              {order.refundedPaise > 0 && (
                <div className={row}>
                  <dt className="text-muted-foreground">Refunded</dt>
                  <dd className="tabular-nums">−{formatINR(order.refundedPaise)}</dd>
                </div>
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative grid gap-4 border-l pl-5">
                {order.statusHistory.map((h) => (
                  <li key={h.id} className="text-sm">
                    <span
                      className="border-card bg-primary absolute -left-1.5 mt-1.5 size-3 rounded-full border-2"
                      aria-hidden
                    />
                    <p className="font-medium">
                      {h.fromStatus ? `${h.fromStatus} → ` : ""}
                      {h.toStatus}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {dt(h.createdAt)} · {h.actorType.toLowerCase()}
                      {h.note ? ` · ${h.note}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments & refunds</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              {order.payments.length === 0 && (
                <p className="text-muted-foreground">No payment attempts yet.</p>
              )}
              {order.payments.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium">
                      {p.method === "COD" ? "Cash on Delivery" : "Razorpay"} ·{" "}
                      {formatINR(p.amountPaise)}
                    </p>
                    <p className="text-muted-foreground font-mono text-xs">
                      {p.razorpayOrderId ?? ""} {p.razorpayPaymentId ?? ""}
                    </p>
                    {p.errorDescription && (
                      <p className="text-destructive text-xs">{p.errorDescription}</p>
                    )}
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              ))}
              {order.refunds.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3"
                >
                  <div>
                    <p className="font-medium">
                      Refund {formatINR(r.amountPaise)} · {r.method.toLowerCase()}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {r.reason} · {dt(r.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))}
              {order.paymentEvents.length > 0 && (
                <details className="text-xs">
                  <summary className="text-muted-foreground cursor-pointer">
                    Gateway events ({order.paymentEvents.length})
                  </summary>
                  <ul className="mt-2 grid gap-1">
                    {order.paymentEvents.map((e) => (
                      <li key={e.id} className="font-mono">
                        {dt(e.receivedAt)} · {e.source} · {e.eventType} ·{" "}
                        {e.signatureValid ? "signed" : "INVALID SIGNATURE"} ·{" "}
                        {e.processedAt ? "processed" : (e.processingError ?? "pending")}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid h-fit gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderAdminActions
                orderId={order.id}
                orderNumber={order.orderNumber}
                status={order.status}
                allowed={[...ORDER_TRANSITIONS[order.status]]}
                paymentMethod={order.paymentMethod}
                paymentStatus={order.paymentStatus}
                refundablePaise={order.totalPaise - order.refundedPaise}
                hasInvoice={Boolean(order.invoice)}
                requiresAttention={order.requiresAttention}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div>
                {order.user ? (
                  <Link
                    href={`/admin/customers/${order.user.id}`}
                    className="font-medium hover:underline"
                  >
                    {order.user.name}
                  </Link>
                ) : (
                  <p className="font-medium">Guest checkout</p>
                )}
                <p className="text-muted-foreground">{order.email}</p>
                <p className="text-muted-foreground">{order.phone}</p>
              </div>
              <Addr a={order.shippingAddress as AddressSnapshot} title="Ship to" />
              <Addr a={order.billingAddress as AddressSnapshot} title="Bill to" />
              {order.customerNote && (
                <p className="bg-muted rounded-lg p-3 text-xs">Note: {order.customerNote}</p>
              )}
            </CardContent>
          </Card>
          {order.shipments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Shipments</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {order.shipments.map((s) => (
                  <div key={s.id}>
                    <p className="font-medium">
                      {s.carrier} <StatusBadge status={s.status} className="ml-1" />
                    </p>
                    {s.trackingNumber && <p className="font-mono text-xs">{s.trackingNumber}</p>}
                    {s.trackingUrl && (
                      <a
                        href={s.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs underline"
                      >
                        Tracking link
                      </a>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
