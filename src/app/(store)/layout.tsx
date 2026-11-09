import { ViewTransition } from "react";
import { SiteFooter } from "@/components/store/site-footer";
import { SiteHeader } from "@/components/store/site-header";
import { WishlistBootstrap } from "@/components/store/wishlist";
import { getCurrentUser } from "@/server/modules/auth/session";
import { wishlistProductIds } from "@/server/modules/wishlist/wishlist";

export default async function StoreLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  const wishlistIds = user ? await wishlistProductIds(user.id) : [];
  return (
    <>
      <WishlistBootstrap signedIn={Boolean(user)} ids={wishlistIds} />
      <a
        href="#main"
        className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {/* Route changes cross-fade (see ::view-transition-*(.page) in globals.css). */}
        <ViewTransition default="page">{children}</ViewTransition>
      </main>
      <SiteFooter />
    </>
  );
}
