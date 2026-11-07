import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { OrderTimeline } from "@/components/store/order-timeline";
import { firstValues } from "@/lib/search-params";
import { formatINR } from "@/lib/money";
import { ORDER_STATUS_LABEL } from "@/server/modules/orders/order-status";
import { ShipmentTracking } from "@/components/store/shipment-tracking";
import { getTrackingView } from "@/server/modules/orders/tracking";

export const metadata: Metadata = {
  title: "Order tracking",
  robots: { index: false, follow: false },
};

/** Read-only tracking view opened from the /track lookup (no address, contact or actions). */
export default async function TrackingResultPage({
  params,
  searchParams,
}: PageProps<"/track/[orderNumber]">) {
  const { orderNumber } = await params;
  const { k } = firstValues(await searchParams);
  const order = await getTrackingView(orderNumber, k ?? null);
  if (!order) notFound();
  const shipment = order.shipments[0];
  return (
    <div className="container-page max-w-3xl py-12">
      <p className="text-muted-foreground text-sm">Tracking</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="heading-display text-3xl sm:text-4xl" data-testid="order-number">
          {order.orderNumber}
        </h1>
        <Badge variant="brand" data-testid="order-status">
          {ORDER_STATUS_LABEL[order.status]}
        </Badge>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        Placed{" "}
        {order.placedAt.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Asia/Kolkata",
        })}{" "}
        · {order.paymentMethod === "COD" ? "Cash on Delivery" : "Paid online"} ·{" "}
        {formatINR(order.totalPaise)}
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-[1fr_1fr]">
        <section className="bg-card rounded-2xl border p-5">
          <h2 className="mb-4 font-semibold">Progress</h2>
          <OrderTimeline history={order.statusHistory} />
        </section>
        <section className="bg-card h-fit rounded-2xl border p-5 text-sm">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Truck className="size-4" aria-hidden /> Shipment
          </h2>
          {shipment ? (
            <ShipmentTracking shipment={shipment} />
          ) : (
            <p className="text-muted-foreground">
              Not shipped yet. You’ll get an email with tracking details once it’s on its way.
            </p>
          )}
        </section>
      </div>

      <section className="bg-card mt-6 rounded-2xl border">
        <h2 className="border-b px-5 py-4 font-semibold">Items</h2>
        <ul className="divide-y">
          {order.items.map((i) => (
            <li key={i.id} className="flex items-center gap-4 px-5 py-4 text-sm">
              <div className="bg-muted relative h-14 w-11 shrink-0 overflow-hidden rounded-md">
                {i.imageUrl && (
                  <Image src={i.imageUrl} alt="" fill sizes="44px" className="object-cover" />
                )}
              </div>
              <div className="flex-1">
                <p className="font-medium">{i.productName}</p>
                <p className="text-muted-foreground">
                  {i.variantName} · Qty {i.quantity}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-muted-foreground mt-6 text-sm">
        Need to change or cancel this order? Open it from your confirmation email or{" "}
        <Link href="/account/orders" className="underline underline-offset-4">
          your account
        </Link>
        , or{" "}
        <Link href="/contact" className="underline underline-offset-4">
          contact us
        </Link>
        .
      </p>
    </div>
  );
}
