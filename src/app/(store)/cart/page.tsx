import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Lock, ShoppingBag, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { CartLines, CouponForm } from "@/components/store/cart-client";
import { OrderSummaryRows } from "@/components/store/order-summary";
import { formatINR } from "@/lib/money";
import { getCurrentCartView } from "@/server/modules/cart/cart-page";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function CartPage() {
  const { view } = await getCurrentCartView();
  const { pricing } = view;
  const blocking = view.issues.length > 0;
  const belowMin = pricing.subtotalPaise - pricing.couponDiscountPaise < view.minOrderPaise;

  if (view.lines.length === 0) {
    return (
      <div className="container-page py-16">
        <EmptyState
          icon={ShoppingBag}
          title="Your cart is empty"
          description="Looks like you haven’t added anything yet. Explore our bestsellers to get started."
          action={
            <Button asChild>
              <Link href="/shop">Start shopping</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="container-page py-10">
      <h1 className="heading-display text-4xl">Your cart</h1>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
        <div className="grid gap-4">
          {pricing.freeShippingRemainingPaise !== null &&
            pricing.freeShippingRemainingPaise > 0 && (
              <p className="bg-brand-soft flex items-center gap-2 rounded-xl px-4 py-3 text-sm">
                <Truck className="text-brand size-4" /> Add{" "}
                {formatINR(pricing.freeShippingRemainingPaise)} more for free shipping.
              </p>
            )}
          <CartLines lines={view.lines} issues={view.issues} />
        </div>
        <aside className="bg-card h-fit rounded-2xl border p-6 lg:sticky lg:top-24">
          <h2 className="text-lg font-semibold">Order summary</h2>
          <div className="mt-5">
            <CouponForm {...view.coupon} />
          </div>
          <div className="mt-6">
            <OrderSummaryRows pricing={pricing} />
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            Shipping and taxes are confirmed at checkout.
          </p>
          {blocking && (
            <p className="text-destructive mt-4 text-sm" role="alert">
              Please resolve the highlighted items before checking out.
            </p>
          )}
          {belowMin && (
            <p className="text-destructive mt-4 text-sm" role="alert">
              The minimum order value is {formatINR(view.minOrderPaise)}.
            </p>
          )}
          {blocking || belowMin ? (
            <Button size="lg" className="mt-6 w-full" disabled>
              Proceed to checkout
            </Button>
          ) : (
            <Button asChild size="lg" className="mt-6 w-full">
              <Link href="/checkout">
                Proceed to checkout <ArrowRight />
              </Link>
            </Button>
          )}
          <p className="text-muted-foreground mt-4 flex items-center justify-center gap-1.5 text-xs">
            <Lock className="size-3.5" /> Secure checkout · UPI, cards, netbanking & COD
          </p>
        </aside>
      </div>
    </div>
  );
}
