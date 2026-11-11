"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SearchBox } from "@/components/store/search-box";

export function MobileNav({
  categories,
  signedIn,
  isAdmin,
  logo,
}: {
  categories: { name: string; slug: string }[];
  signedIn: boolean;
  isAdmin: boolean;
  /** The brand logo (server-rendered <Logo />), shown at the top of the menu. */
  logo?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {/* Clicking the logo goes home; close the menu on the way. */}
          <div onClick={close} className="w-fit">
            {logo}
          </div>
        </SheetHeader>
        <div className="px-5">
          <SearchBox onNavigate={close} />
        </div>
        <nav aria-label="Mobile" className="flex flex-col px-3 pb-6">
          <Link
            href="/shop"
            onClick={close}
            className="hover:bg-accent rounded-lg px-2 py-3 text-base font-medium"
          >
            Shop all
          </Link>
          <p className="text-muted-foreground mt-3 px-2 text-xs font-medium tracking-wider uppercase">
            Categories
          </p>
          {categories.map((c) => (
            <Link
              key={c.slug}
              href={`/category/${c.slug}`}
              onClick={close}
              className="hover:bg-accent rounded-lg px-2 py-2.5"
            >
              {c.name}
            </Link>
          ))}
          <div className="bg-border my-3 h-px" />
          <Link
            href={signedIn ? "/account" : "/login"}
            onClick={close}
            className="hover:bg-accent rounded-lg px-2 py-2.5"
          >
            {signedIn ? "My account" : "Sign in"}
          </Link>
          {signedIn && (
            <Link
              href="/account/orders"
              onClick={close}
              className="hover:bg-accent rounded-lg px-2 py-2.5"
            >
              My orders
            </Link>
          )}
          {isAdmin && (
            <Link href="/admin" onClick={close} className="hover:bg-accent rounded-lg px-2 py-2.5">
              Admin dashboard
            </Link>
          )}
          <Link href="/about" onClick={close} className="hover:bg-accent rounded-lg px-2 py-2.5">
            About
          </Link>
          <Link href="/contact" onClick={close} className="hover:bg-accent rounded-lg px-2 py-2.5">
            Contact
          </Link>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
