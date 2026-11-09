import Link from "next/link";
import { ShoppingBag, User } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <header className="header-settle bg-background/80 supports-[backdrop-filter]:bg-background/65 sticky top-0 z-40 border-b border-transparent [box-shadow:0_1px_0_var(--border)] backdrop-blur-md">
        <div className="container-page flex h-[68px] items-center gap-4">
          <MobileNav
            categories={categories.map((c) => ({ name: c.name, slug: c.slug }))}
            signedIn={Boolean(user)}
            isAdmin={user?.role === "ADMIN"}
          />
          <Logo />
          <nav aria-label="Main" className="ml-4 hidden items-center gap-0.5 lg:flex">
            <Link
              href="/shop"
              className="nav-pill hover:bg-accent rounded-full px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-200"
            >
              Shop all
            </Link>
            {nav.map((c, i) => (
              <Link
                key={c.slug}
                href={`/category/${c.slug}`}
                className={`nav-pill text-muted-foreground hover:bg-accent hover:text-foreground rounded-full px-3.5 py-2 text-sm whitespace-nowrap transition-colors duration-200 ${i >= 2 ? "hidden xl:block" : ""}`}
              >
                {c.name}
              </Link>
            ))}
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
            <Button asChild variant="ghost" size="icon" className="relative">
              <Link
                href="/cart"
                aria-label={`Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}`}
              >
                <ShoppingBag className="size-5" />
                {cartCount > 0 && (
                  <span
                    data-testid="cart-count"
                    className="bg-brand text-brand-foreground ring-background animate-in zoom-in-50 absolute top-1 right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums ring-2 duration-300"
                  >
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                )}
              </Link>
            </Button>
          </div>
        </div>
        <div className="container-page pb-3 md:hidden">
          <SearchBox />
        </div>
      </header>
    </>
  );
}
