"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RotateCw,
  ShoppingBag,
  Trash2,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { QuantityStepper } from "@/components/store/quantity-stepper";
import { OrderSummaryRows } from "@/components/store/order-summary";
import { cartChanged, setCartOpen, takeOpener, useCartUi } from "@/components/store/cart-store";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { siteImageHref } from "@/lib/site-images";
import type { CartView } from "@/server/modules/cart/cart";

type Load = { status: "idle" | "loading" | "ready" | "error"; view: CartView | null };

/**
 * Slide-out cart. Contents, prices and totals come from `GET /api/cart` (server-priced); quantity
 * changes and removals use the same endpoints as the cart page. Radix Dialog provides the focus
 * trap, Escape / backdrop to close, background scroll lock and focus return.
 */
export function CartDrawer() {
  const { open, reason, version } = useCartUi();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ status: "idle", view: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const reqId = useRef(0);

  // Used after quantity changes / removals and for "Try again".
  const fetchCart = useCallback(async () => {
    const id = ++reqId.current;
    try {
      const res = await fetch("/api/cart", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const view = (await res.json()).data as CartView;
      if (id === reqId.current) setLoad({ status: "ready", view });
    } catch {
      if (id === reqId.current)
        setLoad((l) => ({ status: l.view ? "ready" : "error", view: l.view }));
    }
  }, []);

  // Refetch whenever the drawer opens or the cart changes (state is only set in callbacks).
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const id = ++reqId.current;
    fetch("/api/cart", { cache: "no-store", signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((json) => {
        if (id === reqId.current) setLoad({ status: "ready", view: json.data as CartView });
      })
      .catch(() => {
        if (!ctrl.signal.aborted && id === reqId.current)
          setLoad((l) => ({ status: l.view ? "ready" : "error", view: l.view }));
      });
    return () => ctrl.abort();
  }, [open, version]);

  const mutate = async (
    lineId: string,
    quantity: number,
    undo?: { variantId: string; quantity: number; name: string },
  ) => {
    setBusy(lineId);
    if (quantity === 0) setLeaving(lineId);
    try {
      await apiFetch(`/api/cart/items/${lineId}`, {
        method: quantity === 0 ? "DELETE" : "PATCH",
        body: quantity === 0 ? undefined : { quantity },
      });
      if (undo) {
        toast.success(`Removed ${undo.name}`, {
          action: {
            label: "Undo",
            onClick: async () => {
              await apiFetch("/api/cart/items", {
                body: { variantId: undo.variantId, quantity: undo.quantity },
              }).catch(() => toast.error("Could not restore the item"));
              cartChanged();
              router.refresh();
            },
          },
        });
      }
      await fetchCart();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not update your cart");
    } finally {
      setBusy(null);
      setLeaving(null);
    }
  };

  const view = load.view;
  const lines = view?.lines ?? [];
  const pricing = view?.pricing;
  const blocking = (view?.issues.length ?? 0) > 0;
  const belowMin =
    !!view && !!pricing && pricing.subtotalPaise - pricing.couponDiscountPaise < view.minOrderPaise;
  const count = lines.reduce((s, l) => s + l.quantity, 0);

  return (
    <Sheet open={open} onOpenChange={setCartOpen}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-md"
        data-testid="cart-drawer"
        onCloseAutoFocus={(e) => {
          const el = takeOpener();
          if (el?.isConnected) {
            e.preventDefault();
            el.focus();
          }
        }}
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="heading-display text-2xl font-normal">
            Your cart{count > 0 ? ` (${count})` : ""}
          </SheetTitle>
          <SheetDescription className={reason === "added" ? "sr-only" : undefined}>
            Review your items before checkout.
          </SheetDescription>
          {reason === "added" && (
            <p
              role="status"
              className="text-success animate-in fade-in-0 slide-in-from-top-1 flex items-center gap-1.5 text-sm font-medium duration-300"
            >
              <CheckCircle2 className="size-4" aria-hidden /> Added to your cart
            </p>
          )}
        </SheetHeader>

        {load.status !== "error" && !view && (
          <div className="grid gap-4 p-5" aria-busy="true" aria-label="Loading your cart">
            {[0, 1].map((i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="h-24 w-20 rounded-lg" />
                <div className="flex-1 space-y-2 py-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-8 w-28 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        {load.status === "error" && !view && (
          <div
            className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
            role="alert"
          >
            <AlertTriangle className="text-destructive size-8" aria-hidden />
            <p className="text-sm">We couldn’t load your cart.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoad({ status: "loading", view: null });
                void fetchCart();
              }}
            >
              <RotateCw /> Try again
            </Button>
          </div>
        )}

        {view && lines.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="bg-leaf-soft text-primary flex size-16 items-center justify-center rounded-full">
              <ShoppingBag className="size-7" aria-hidden />
            </div>
            <div>
              <p className="font-medium">Your cart is empty</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Explore our spices, dry fruits and makhana.
              </p>
            </div>
            <SheetClose asChild>
              <Button asChild>
                <Link href="/shop">
                  Start shopping <ArrowRight />
                </Link>
              </Button>
            </SheetClose>
          </div>
        )}

        {view && lines.length > 0 && pricing && (
          <>
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {pricing.freeShippingRemainingPaise !== null &&
                pricing.freeShippingRemainingPaise > 0 && (
                  <p className="bg-brand-soft mx-5 mt-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm">
                    <Truck className="text-brand size-4 shrink-0" aria-hidden /> Add{" "}
                    {formatINR(pricing.freeShippingRemainingPaise)} more for free shipping.
                  </p>
                )}
              <ul className="divide-y px-5">
                {lines.map((l) => {
                  const issue = view.issues.find((i) => i.itemId === l.id);
                  return (
                    <li
                      key={l.id}
                      data-testid="drawer-line"
                      className={cn(
                        "flex gap-4 py-4 transition-[opacity,transform] duration-300",
                        leaving === l.id && "translate-x-4 opacity-0",
                      )}
                    >
                      <Link
                        href={`/product/${l.productSlug}`}
                        onClick={() => setCartOpen(false)}
                        className="bg-muted relative h-24 w-20 shrink-0 overflow-hidden rounded-lg"
                        tabIndex={-1}
                        aria-hidden
                      >
                        <Image
                          src={l.imageUrl ?? siteImageHref("productPlaceholder")}
                          alt=""
                          fill
                          sizes="80px"
                          unoptimized={!l.imageUrl}
                          className="object-cover"
                        />
                      </Link>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link
                              href={`/product/${l.productSlug}`}
                              onClick={() => setCartOpen(false)}
                              className="link-draw text-sm font-medium"
                            >
                              {l.productName}
                            </Link>
                            <p className="text-muted-foreground text-xs">{l.variantName}</p>
                            <p className="mt-0.5 text-xs tabular-nums">
                              {formatINR(l.unitPricePaise)}
                              {l.compareAtPaise && l.compareAtPaise > l.unitPricePaise && (
                                <span className="text-muted-foreground ml-1.5 line-through">
                                  {formatINR(l.compareAtPaise)}
                                </span>
                              )}
                            </p>
                          </div>
                          <p className="text-sm font-semibold tabular-nums">
                            {formatINR(l.lineTotalPaise)}
                          </p>
                        </div>
                        {issue && (
                          <p
                            className="text-destructive mt-1.5 flex items-center gap-1 text-xs font-medium"
                            role="alert"
                          >
                            <AlertTriangle className="size-3.5" aria-hidden /> {issue.message}
                          </p>
                        )}
                        <div className="mt-auto flex items-center justify-between pt-2">
                          {l.purchasable ? (
                            <QuantityStepper
                              size="sm"
                              value={l.quantity}
                              max={Math.min(10, Math.max(l.available, l.quantity))}
                              disabled={busy === l.id}
                              onChange={(q) => void mutate(l.id, q)}
                              label={`Quantity for ${l.productName}`}
                            />
                          ) : (
                            <span className="text-muted-foreground text-xs">Unavailable</span>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() =>
                              void mutate(l.id, 0, {
                                variantId: l.variantId,
                                quantity: l.quantity,
                                name: l.productName,
                              })
                            }
                            disabled={busy === l.id}
                            aria-label={`Remove ${l.productName}`}
                            className="hover:text-destructive"
                          >
                            {busy === l.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="bg-background/60 border-t p-5">
              <OrderSummaryRows pricing={pricing} />
              <p className="text-muted-foreground mt-2 text-xs">
                Shipping and taxes are confirmed at checkout.
              </p>
              {blocking && (
                <p className="text-destructive mt-2 text-xs" role="alert">
                  Please resolve the highlighted items before checking out.
                </p>
              )}
              {belowMin && (
                <p className="text-destructive mt-2 text-xs" role="alert">
                  The minimum order value is {formatINR(view.minOrderPaise)}.
                </p>
              )}
              <div className="mt-4 grid gap-2">
                {blocking || belowMin ? (
                  <Button size="lg" disabled>
                    Checkout
                  </Button>
                ) : (
                  <SheetClose asChild>
                    <Button asChild size="lg">
                      <Link href="/checkout">
                        Checkout <ArrowRight />
                      </Link>
                    </Button>
                  </SheetClose>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <SheetClose asChild>
                    <Button variant="outline">Continue shopping</Button>
                  </SheetClose>
                  <SheetClose asChild>
                    <Button asChild variant="outline">
                      <Link href="/cart">View cart</Link>
                    </Button>
                  </SheetClose>
                </div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
