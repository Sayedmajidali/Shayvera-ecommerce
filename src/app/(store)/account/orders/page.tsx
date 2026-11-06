import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { FileText, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { Pagination } from "@/components/store/pagination";
import { formatINR } from "@/lib/money";
import { firstValues } from "@/lib/search-params";
import { requireUserPage } from "@/server/modules/auth/session";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "@/server/modules/orders/order-status";
import { listCustomerOrders } from "@/server/modules/orders/orders";

export const metadata: Metadata = { title: "My orders", robots: { index: false } };

export default async function OrdersPage({ searchParams }: PageProps<"/account/orders">) {
  const user = await requireUserPage("/account/orders");
  const sp = firstValues(await searchParams);
  const page = Math.max(1, Number(sp.page) || 1);
  const { orders, pageCount } = await listCustomerOrders(user.id, page);
  if (orders.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No orders yet"
        description="When you place an order it will appear here."
        action={
          <Button asChild>
            <Link href="/shop">Start shopping</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div>
      <h2 className="mb-6 text-xl font-semibold">Order history</h2>
      <ul className="grid gap-4">
        {orders.map((o) => (
          <li key={o.id}>
            <Link
              href={`/account/orders/${o.orderNumber}`}
              className="bg-card hover:shadow-soft flex flex-wrap items-center gap-4 rounded-2xl border p-5 transition"
              data-testid="order-row"
            >
              <div className="flex -space-x-3">
                {o.items.slice(0, 3).map((i, idx) => (
                  <div
                    key={idx}
                    className="border-card bg-muted relative h-14 w-11 overflow-hidden rounded-lg border-2"
                  >
                    {i.imageUrl && (
                      <Image src={i.imageUrl} alt="" fill sizes="44px" className="object-cover" />
                    )}
                  </div>
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{o.orderNumber}</p>
                <p className="text-muted-foreground truncate text-sm">
                  {o.placedAt.toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}{" "}
                  · {o.items.reduce((s, i) => s + i.quantity, 0)} item(s)
                </p>
              </div>
              <Badge variant={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
              <p className="w-24 text-right font-semibold tabular-nums">
                {formatINR(o.totalPaise)}
              </p>
            </Link>
            {o.invoice && (
              <a
                href={`/invoice/${o.orderNumber}`}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground mt-2 ml-5 inline-flex items-center gap-1.5 text-xs underline-offset-4 hover:underline"
              >
                <FileText className="size-3.5" aria-hidden /> Invoice {o.invoice.invoiceNumber}
              </a>
            )}
          </li>
        ))}
      </ul>
      <Pagination page={page} pageCount={pageCount} basePath="/account/orders" searchParams={sp} />
    </div>
  );
}
