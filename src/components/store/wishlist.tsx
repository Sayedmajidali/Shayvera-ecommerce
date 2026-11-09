"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

/**
 * Client-side mirror of the signed-in user's wishlist, seeded once by the store layout so heart
 * buttons on any page render without extra requests. The server remains the source of truth.
 */
type State = { signedIn: boolean; ids: Set<string> };
let state: State = { signedIn: false, ids: new Set() };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const serverSnapshot: State = { signedIn: false, ids: new Set() };

function setIds(update: (ids: Set<string>) => void) {
  const ids = new Set(state.ids);
  update(ids);
  state = { ...state, ids };
  emit();
}

/** Rendered by the store layout with the server-side wishlist. */
export function WishlistBootstrap({ signedIn, ids }: { signedIn: boolean; ids: string[] }) {
  const key = `${signedIn}:${ids.join(",")}`;
  useEffect(() => {
    state = { signedIn, ids: new Set(ids) };
    emit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures signedIn + ids
  }, [key]);
  return null;
}

export function useWishlist() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => serverSnapshot,
  );
}

export function WishlistButton({
  productId,
  productName,
  variant = "icon",
  className,
}: {
  productId: string;
  productName: string;
  variant?: "icon" | "full";
  className?: string;
}) {
  const { signedIn, ids } = useWishlist();
  const router = useRouter();
  const pathname = usePathname();
  const saved = ids.has(productId);
  // Bumped on each toggle so the heart pops only when the user acts (not on page load).
  const [pop, setPop] = useState(0);

  const toggle = async () => {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    // Optimistic update, rolled back on failure.
    setPop((p) => p + 1);
    setIds((s) => (saved ? s.delete(productId) : s.add(productId)));
    try {
      if (saved) await apiFetch(`/api/account/wishlist/${productId}`, { method: "DELETE" });
      else await apiFetch("/api/account/wishlist", { body: { productId } });
      toast.success(saved ? "Removed from wishlist" : "Saved to wishlist");
    } catch (err) {
      setIds((s) => (saved ? s.add(productId) : s.delete(productId)));
      toast.error(err instanceof ApiClientError ? err.message : "Could not update wishlist");
    }
  };

  const label = saved ? `Remove ${productName} from wishlist` : `Save ${productName} to wishlist`;
  if (variant === "full") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={saved}
        aria-label={label}
        className={cn(
          "bg-card hover:border-foreground/40 inline-flex h-11 items-center justify-center gap-2 rounded-full border px-5 text-sm font-medium transition active:scale-95",
          className,
        )}
      >
        <Heart
          key={pop}
          className={cn(
            "size-4 transition-colors",
            saved && "fill-brand text-brand",
            pop > 0 && "animate-heart-pop",
          )}
          aria-hidden
        />
        {saved ? "Saved" : "Save"}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={label}
      className={cn(
        "bg-background/90 hover:bg-background focus-visible:ring-ring/40 flex size-9 items-center justify-center rounded-full shadow-sm backdrop-blur transition outline-none hover:scale-105 focus-visible:ring-[3px] active:scale-90",
        className,
      )}
    >
      <Heart
        key={pop}
        className={cn(
          "size-4 transition-colors",
          saved ? "fill-brand text-brand" : "text-foreground",
          pop > 0 && "animate-heart-pop",
        )}
        aria-hidden
      />
    </button>
  );
}
