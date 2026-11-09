import { cn } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { AddToCartButton } from "@/components/store/add-to-cart-button";
import { Price } from "@/components/store/price";
import { RatingStars } from "@/components/store/rating-stars";
import { WishlistButton } from "@/components/store/wishlist";
import { QuickViewButton } from "@/components/store/quick-view-store";
import type { ProductCardData } from "@/server/modules/catalog/queries";

export function ProductCard({
  product,
  priority = false,
}: {
  product: ProductCardData;
  priority?: boolean;
}) {
  const [primary, secondary] = product.images;
  return (
    <article
      className="group lift bg-card hover:border-border relative flex flex-col rounded-2xl border border-transparent p-2 pb-4"
      data-testid="product-card"
    >
      {/* Same destination as the title link below: hidden from keyboard and screen readers so each
          product is one tab stop and its name is announced once. */}
      <Link
        href={`/product/${product.slug}`}
        aria-hidden
        tabIndex={-1}
        className="bg-muted relative block aspect-[4/5] overflow-hidden rounded-xl [mask-image:radial-gradient(white,black)]"
      >
        {primary ? (
          <>
            <Image
              src={primary.url}
              alt={primary.alt || product.name}
              fill
              priority={priority}
              sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw"
              className="zoom-img object-cover"
            />
            {secondary && (
              <Image
                src={secondary.url}
                alt=""
                fill
                sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw"
                className="zoom-img object-cover opacity-0 transition-[opacity,transform] duration-700 group-hover:opacity-100"
              />
            )}
          </>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            No image
          </div>
        )}
        <div className="absolute top-3 left-3 flex flex-col gap-1.5">
          {!product.inStock && <Badge variant="secondary">Sold out</Badge>}
          {product.inStock && product.compareAtPaise && <Badge variant="brand">Sale</Badge>}
          {product.inStock && product.isNew && !product.compareAtPaise && (
            <Badge variant="outline" className="bg-card">
              New
            </Badge>
          )}
        </div>
        <span className="sr-only">{product.name}</span>
      </Link>
      <div className="absolute top-5 right-5 flex flex-col items-end gap-2">
        <WishlistButton productId={product.id} productName={product.name} />
        {/* Revealed on hover/focus with pointer devices; always visible on touch screens. */}
        <div className="flex flex-col items-end gap-2 transition-[opacity,transform] duration-300 ease-[var(--ease-out)] [@media(hover:hover)]:translate-x-2 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:translate-x-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:translate-x-0 [@media(hover:hover)]:group-hover:opacity-100">
          <QuickViewButton slug={product.slug} name={product.name} />
          {product.defaultVariantId && product.inStock && (
            <AddToCartButton
              variantId={product.defaultVariantId}
              compact
              label={`Add ${product.name} to cart`}
              className="shadow-soft"
            />
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-1 flex-col gap-1 px-1.5">
        <p className="text-primary text-[11px] font-medium tracking-wider uppercase">
          {product.categoryName}
        </p>
        <h3 className="text-[15px] leading-snug font-medium">
          <Link href={`/product/${product.slug}`} className="link-draw">
            {product.name}
          </Link>
        </h3>
        {product.ratingCount > 0 && (
          <RatingStars rating={product.rating} count={product.ratingCount} />
        )}
        <Price
          paise={product.pricePaise}
          compareAtPaise={product.compareAtPaise}
          from={product.variantCount > 1}
          className="mt-1"
        />
        {product.lowStock && <p className="text-brand text-xs font-medium">Only a few left</p>}
      </div>
    </article>
  );
}

export function ProductGrid({
  products,
  priorityCount = 0,
  heading,
  reveal = true,
}: {
  products: ProductCardData[];
  priorityCount?: number;
  /**
   * Screen-reader heading for pages with no visible h2 above the grid (cards use h3 titles, so this
   * keeps the outline h1 → h2 → h3). Omit where the surrounding section already has an h2.
   */
  heading?: string;
  /**
   * Fade cards in as they scroll into view. Off for grids at the top of a page (listings), where
   * the first row is already visible and a fade would only delay the largest paint.
   */
  reveal?: boolean;
}) {
  const grid = (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 md:grid-cols-3 lg:gap-x-5 lg:gap-y-8 xl:grid-cols-4",
      )}
      data-reveal-stagger={reveal ? "" : undefined}
    >
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} priority={i < priorityCount} />
      ))}
    </div>
  );
  if (!heading) return grid;
  return (
    <>
      <h2 className="sr-only">{heading}</h2>
      {grid}
    </>
  );
}
