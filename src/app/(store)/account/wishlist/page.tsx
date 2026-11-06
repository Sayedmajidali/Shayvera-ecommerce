import Link from "next/link";
import type { Metadata } from "next";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { WishlistGrid } from "@/components/store/wishlist-grid";
import { requireUserPage } from "@/server/modules/auth/session";
import { getWishlist } from "@/server/modules/wishlist/wishlist";

export const metadata: Metadata = { title: "Wishlist", robots: { index: false } };

export default async function WishlistPage() {
  const user = await requireUserPage("/account/wishlist");
  const entries = await getWishlist(user.id);
  return (
    <section aria-labelledby="wishlist-heading">
      <h1 id="wishlist-heading" className="heading-display text-3xl">
        Wishlist
      </h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Products you’ve saved. Prices and stock are always current.
      </p>
      <div className="mt-6">
        {entries.length === 0 ? (
          <EmptyState
            icon={Heart}
            title="Nothing saved yet"
            description="Tap the heart on any product to save it here."
            action={
              <Button asChild>
                <Link href="/shop">Browse products</Link>
              </Button>
            }
          />
        ) : (
          <WishlistGrid
            available={entries.filter((e) => e.available).map((e) => e.product)}
            unavailable={entries
              .filter((e) => !e.available)
              .map((e) => ({ id: e.product.id, name: e.product.name }))}
          />
        )}
      </div>
    </section>
  );
}
