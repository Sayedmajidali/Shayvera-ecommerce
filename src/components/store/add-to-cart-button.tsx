"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

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

  return (
    <Button
      type="button"
      size={compact ? "icon-sm" : size}
      className={cn(className)}
      disabled={disabled || pending || !variantId}
      aria-label={compact ? label : undefined}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!variantId) return;
        setPending(true);
        try {
          await apiFetch("/api/cart/items", { body: { variantId, quantity } });
          toast.success("Added to your cart", {
            action: { label: "View cart", onClick: () => router.push("/cart") },
          });
          router.refresh();
        } catch (err) {
          toast.error(err instanceof ApiClientError ? err.message : "Could not add to cart");
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : <ShoppingBag />}
      {!compact && label}
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
