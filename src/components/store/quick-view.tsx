"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductPurchase } from "@/components/store/product-purchase";
import { RatingStars } from "@/components/store/rating-stars";
import { useCartUi } from "@/components/store/cart-store";
import { setQuickView, useQuickViewSlug } from "@/components/store/quick-view-store";
import { cn } from "@/lib/utils";
import type { ProductDetail } from "@/server/modules/catalog/queries";

type Entry = ProductDetail | "error";
/** Products fetched this session (quick re-opening without another request). */
const fetched = new Map<string, Entry>();

export function QuickViewDialog() {
  const slug = useQuickViewSlug();
  const { open: cartOpen } = useCartUi();

  // Adding to the cart opens the cart drawer; step aside for it.
  useEffect(() => {
    if (cartOpen && slug) setQuickView(null);
  }, [cartOpen, slug]);

  return (
    <Dialog open={!!slug} onOpenChange={(o) => !o && setQuickView(null)}>
      <DialogContent
        className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-4xl gap-0 overflow-y-auto p-0 sm:max-w-4xl sm:rounded-3xl"
        data-testid="quick-view"
      >
        {slug && <QuickViewBody key={slug} slug={slug} />}
      </DialogContent>
    </Dialog>
  );
}

function QuickViewBody({ slug }: { slug: string }) {
  const [entry, setEntry] = useState<Entry | undefined>(() => fetched.get(slug));
  const [img, setImg] = useState(0);

  useEffect(() => {
    if (fetched.has(slug)) return;
    const ctrl = new AbortController();
    fetch(`/api/products/${encodeURIComponent(slug)}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const product = (await res.json()).data as ProductDetail;
        fetched.set(slug, product);
        setEntry(product);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setEntry("error");
      });
    return () => ctrl.abort();
  }, [slug]);

  const load =
    entry === undefined
      ? ({ status: "loading" } as const)
      : entry === "error"
        ? ({ status: "error" } as const)
        : ({ status: "ready", product: entry } as const);
  const product = load.status === "ready" ? load.product : null;
  const rating =
    product && product.reviews.length
      ? product.reviews.reduce((s, r) => s + r.rating, 0) / product.reviews.length
      : 0;

  return (
    <>
      {load.status === "loading" && (
        <div className="grid gap-6 p-6 md:grid-cols-2" aria-busy="true">
          <DialogTitle className="sr-only">Loading product</DialogTitle>
          <DialogDescription className="sr-only">Product details are loading.</DialogDescription>
          <Skeleton className="aspect-[4/5] w-full rounded-2xl" />
          <div className="space-y-4 py-2">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-10 w-1/3" />
            <Skeleton className="h-12 w-full rounded-full" />
          </div>
        </div>
      )}
      {load.status === "error" && (
        <div className="flex flex-col items-center gap-3 p-10 text-center" role="alert">
          <DialogTitle>Couldn’t load this product</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <AlertTriangle className="text-destructive size-4" aria-hidden /> Please try again.
          </DialogDescription>
          {slug && (
            <Link href={`/product/${slug}`} className="link-draw text-primary text-sm font-medium">
              Open the product page
            </Link>
          )}
        </div>
      )}
      {product && (
        <div className="grid md:grid-cols-2">
          <div className="bg-muted relative">
            <div className="relative aspect-[4/5] overflow-hidden md:rounded-l-3xl">
              {product.images[img] && (
                <Image
                  key={product.images[img].url}
                  src={product.images[img].url}
                  alt={product.images[img].alt || product.name}
                  fill
                  sizes="(min-width: 768px) 448px, 100vw"
                  className="animate-in fade-in-0 object-cover duration-300"
                />
              )}
            </div>
            {product.images.length > 1 && (
              <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
                {product.images.map((im, i) => (
                  <button
                    key={im.url}
                    type="button"
                    aria-label={`Show image ${i + 1} of ${product.images.length}`}
                    aria-pressed={i === img}
                    onClick={() => setImg(i)}
                    className={cn(
                      "h-2 rounded-full transition-all duration-300",
                      i === img ? "bg-primary w-6" : "w-2 bg-white/80 hover:bg-white",
                    )}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col p-6 sm:p-8">
            <p className="text-brand text-xs font-semibold tracking-[0.2em] uppercase">
              {product.category.name}
            </p>
            <DialogTitle className="heading-display mt-2 pr-8 text-3xl leading-tight font-normal">
              {product.name}
            </DialogTitle>
            {product.reviews.length > 0 && (
              <RatingStars rating={rating} count={product.reviews.length} className="mt-2" />
            )}
            <DialogDescription className="text-muted-foreground mt-3 text-sm leading-6">
              {product.shortDescription ?? "Carefully selected and hygienically packed."}
            </DialogDescription>
            <div className="mt-6">
              <ProductPurchase
                product={{ id: product.id, name: product.name }}
                variants={product.variants}
              />
            </div>
            <Link
              href={`/product/${product.slug}`}
              onClick={() => setQuickView(null)}
              className="group text-primary mt-6 inline-flex items-center gap-1.5 text-sm font-semibold"
            >
              <span className="link-draw">View full details</span>
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
