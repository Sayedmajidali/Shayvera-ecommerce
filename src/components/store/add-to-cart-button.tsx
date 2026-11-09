"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { openCart } from "@/components/store/cart-store";

export function AddToCartButton({
  variantId,
  quantity = 1,
  disabled,
  className,
  size = "lg",
  label = "Add to cart",
  compact = false,
}: {
  variantId: string | null;
  quantity?: number;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default" | "lg";
  label?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 1800);
    return () => clearTimeout(t);
  }, [added]);

  return (
    <Button
      type="button"
      size={compact ? "icon-sm" : size}
      className={cn(added && "bg-success hover:bg-success text-white", className)}
      data-state={added ? "added" : pending ? "pending" : "idle"}
      disabled={disabled || pending || !variantId}
      aria-label={compact ? label : undefined}
      onClick={async (e) => {
        const self = e.currentTarget;
        e.preventDefault();
        e.stopPropagation();
        if (!variantId) return;
        setPending(true);
        try {
          await apiFetch("/api/cart/items", { body: { variantId, quantity } });
          setAdded(true);
          // The drawer confirms the addition ("Added to your cart") and shows server totals.
          openCart("added", self);
          router.refresh();
        } catch (err) {
          toast.error(err instanceof ApiClientError ? err.message : "Could not add to cart");
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? (
        <Loader2 className="animate-spin" />
      ) : added ? (
        <Check className="animate-in zoom-in-50 duration-300" />
      ) : (
        <ShoppingBag />
      )}
      {!compact && (added ? "Added" : label)}
    </Button>
  );
}

export function ViewCartLink() {
  return (
    <Link href="/cart" className="text-sm font-medium underline underline-offset-4">
      View cart
    </Link>
  );
}
