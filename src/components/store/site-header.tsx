import Link from "next/link";
import { Heart, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CartButton } from "@/components/store/cart-button";
import { HeaderShell, NavLinks } from "@/components/store/header-shell";
import { Logo } from "@/components/store/logo";
import { MobileNav } from "@/components/store/mobile-nav";
import { SearchBox } from "@/components/store/search-box";
import { UserMenu } from "@/components/store/user-menu";
import { formatINR } from "@/lib/money";
import { getCurrentUser } from "@/server/modules/auth/session";
import { getNavCategories } from "@/server/modules/catalog/queries";
import { getCartItemCount } from "@/server/modules/cart/cart-count";
import { getStoreSettings } from "@/server/modules/settings/queries";
import { formatIndianMobile } from "@/lib/india";

export async function SiteHeader() {
  const [user, categories, cartCount, settings] = await Promise.all([
    getCurrentUser(),
    getNavCategories(),
    getCartItemCount(),
    getStoreSettings(),
  ]);
  const nav = categories.slice(0, 4);

  return (
    <>
      {settings.freeShippingThresholdPaise !== null && (
        <aside aria-label="Store announcement" className="bg-deep text-deep-foreground">
          <p className="container-page flex items-center justify-center gap-2 py-2 text-center text-xs tracking-wide">
            <span className="bg-leaf inline-block size-1.5 shrink-0 rounded-full" aria-hidden />
            Free shipping across India on orders above{" "}
            {formatINR(settings.freeShippingThresholdPaise)}
            {settings.codEnabled && " · Cash on Delivery available"}
          </p>
        </aside>
      )}
      <div className="scroll-progress" aria-hidden />
      <HeaderShell className="bg-background/80 supports-[backdrop-filter]:bg-background/65 data-[scrolled]:bg-background/92 sticky top-0 z-40 border-b border-transparent [box-shadow:0_1px_0_var(--border)] backdrop-blur-md transition-[background-color,box-shadow] duration-300 data-[scrolled]:[box-shadow:0_10px_30px_-14px_oklch(0.3_0.06_165/0.3)]">
        <div className="container-page flex h-[68px] items-center gap-4">
          <MobileNav
            categories={categories.map((c) => ({ name: c.name, slug: c.slug }))}
            signedIn={Boolean(user)}
            isAdmin={user?.role === "ADMIN"}
            logo={<Logo />}
          />
          <Logo className="origin-left transition-transform duration-300 group-data-[scrolled]/header:scale-[0.9]" />
          <nav aria-label="Main" className="ml-4 hidden items-center gap-0.5 lg:flex">
            <NavLinks
              links={[
                { href: "/shop", label: "Shop all" },
                ...nav.map((c, i) => ({
                  href: `/category/${c.slug}`,
                  label: c.name,
                  wideOnly: i >= 2,
                })),
              ]}
            />
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <SearchBox className="mr-2 hidden w-56 md:block xl:w-64" />
            {user ? (
              <UserMenu
                name={user.name}
                email={
                  user.hasPlaceholderEmail && user.phoneNumber
                    ? formatIndianMobile(user.phoneNumber)
                    : user.email
                }
                isAdmin={user.role === "ADMIN"}
              />
            ) : (
              <Button asChild variant="ghost" size="icon" aria-label="Sign in">
                <Link href="/login">
                  <User className="size-5" />
                </Link>
              </Button>
            )}
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="hidden sm:inline-flex"
              aria-label="Wishlist"
            >
              <Link href="/account/wishlist">
                <Heart className="size-5" />
              </Link>
            </Button>
            <CartButton count={cartCount} />
          </div>
        </div>
        <div className="container-page pb-3 md:hidden">
          <SearchBox />
        </div>
      </HeaderShell>
    </>
  );
}
