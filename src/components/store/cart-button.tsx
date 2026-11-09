"use client";

import { ShoppingBag } from "lucide-react";
import { openCart } from "@/components/store/cart-store";
import { cn } from "@/lib/utils";

/**
 * Header cart icon. Opens the cart drawer; still a real link to /cart, so it works without
 * JavaScript and with modifier-clicks (new tab). The badge pops whenever the count changes.
 */
export function CartButton({ count }: { count: number }) {
  return (
    <a
      href="/cart"
      aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}
      aria-haspopup="dialog"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        openCart("click", e.currentTarget);
      }}
      className="hover:bg-accent focus-visible:ring-ring/40 relative inline-flex size-10 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-[3px] active:scale-95"
    >
      <ShoppingBag className="size-5" />
      {count > 0 && (
        <span
          key={count}
          data-testid="cart-count"
          className={cn(
            "bg-brand text-brand-foreground ring-background animate-badge-pop absolute top-1 right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums ring-2",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </a>
  );
}
