import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { OrderDetail } from "@/components/store/order-detail";
import { requireUserPage } from "@/server/modules/auth/session";
import { getCustomerOrder } from "@/server/modules/orders/orders";

export const metadata: Metadata = { title: "Order details", robots: { index: false } };

export default async function AccountOrderPage({
  params,
}: PageProps<"/account/orders/[orderNumber]">) {
  const { orderNumber } = await params;
  const user = await requireUserPage(`/account/orders/${orderNumber}`);
  const order = await getCustomerOrder(user.id, orderNumber).catch(() => null);
  if (!order) notFound();
  return (
    <div>
      <Link
        href="/account/orders"
        className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> All orders
      </Link>
      <OrderDetail order={order} token={null} />
    </div>
  );
}
