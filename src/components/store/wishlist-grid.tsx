"use client";

import { ProductCard } from "@/components/store/product-card";
import { useWishlist, WishlistButton } from "@/components/store/wishlist";
import type { ProductCardData } from "@/server/modules/catalog/queries";

/** Wishlist page grid: items un-hearted on this page disappear without a reload. */
export function WishlistGrid({
  available,
  unavailable,
}: {
  available: ProductCardData[];
  unavailable: { id: string; name: string }[];
}) {
  const { signedIn, ids } = useWishlist();
  // Before the client store is seeded (server render), show everything.
  const keep = (id: string) => !signedIn || ids.has(id);
  const shown = available.filter((p) => keep(p.id));
  const gone = unavailable.filter((p) => keep(p.id));
  return (
    <div className="grid gap-8">
      {shown.length > 0 && (
        <div>
          <h2 className="sr-only">Saved products</h2>
          <div
            className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3"
            data-testid="wishlist-grid"
          >
            {shown.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      )}
      {gone.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold">No longer available</h2>
          <ul className="mt-3 divide-y rounded-2xl border">
            {gone.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <span className="text-muted-foreground">{p.name}</span>
                <WishlistButton productId={p.id} productName={p.name} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {shown.length === 0 && gone.length === 0 && (
        <p className="text-muted-foreground text-sm">Your wishlist is empty.</p>
      )}
    </div>
  );
}
