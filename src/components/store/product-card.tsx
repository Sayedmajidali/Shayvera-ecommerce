import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { AddToCartButton } from "@/components/store/add-to-cart-button";
import { Price } from "@/components/store/price";
import { RatingStars } from "@/components/store/rating-stars";
import type { ProductCardData } from "@/server/queries/catalog";

export function ProductCard({
  product,
  priority = false,
}: {
  product: ProductCardData;
  priority?: boolean;
}) {
  const [primary, secondary] = product.images;
  return (
    <article className="group relative flex flex-col" data-testid="product-card">
      <Link
        href={`/product/${product.slug}`}
        className="bg-muted relative block aspect-[4/5] overflow-hidden rounded-xl"
      >
        {primary ? (
          <>
            <Image
              src={primary.url}
              alt={primary.alt || product.name}
              fill
              priority={priority}
              sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
            />
            {secondary && (
              <Image
                src={secondary.url}
                alt=""
                fill
                sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw"
                className="object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100"
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
      {product.defaultVariantId && product.inStock && (
        <div className="absolute top-3 right-3 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          <AddToCartButton
            variantId={product.defaultVariantId}
            compact
            label={`Add ${product.name} to cart`}
            className="shadow-soft"
          />
        </div>
      )}
      <div className="mt-3 flex flex-1 flex-col gap-1">
        <p className="text-muted-foreground text-xs">{product.categoryName}</p>
        <h3 className="text-[15px] leading-snug font-medium">
          <Link
            href={`/product/${product.slug}`}
            className="hover:underline hover:underline-offset-4"
          >
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
}: {
  products: ProductCardData[];
  priorityCount?: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:gap-x-6 xl:grid-cols-4">
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} priority={i < priorityCount} />
      ))}
    </div>
  );
}
