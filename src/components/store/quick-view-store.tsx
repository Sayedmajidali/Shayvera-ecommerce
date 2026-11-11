"use client";

import { useSyncExternalStore } from "react";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";

/** Which product's Quick View is open (null = closed). Shared by the card buttons and the dialog. */
let current: string | null = null;
const listeners = new Set<() => void>();
export function setQuickView(slug: string | null) {
  current = slug;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export function useQuickViewSlug() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

export function QuickViewButton({
  slug,
  name,
  className,
}: {
  slug: string;
  name: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Quick view ${name}`}
      aria-haspopup="dialog"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setQuickView(slug);
      }}
      className={cn(
        "bg-background/95 hover:bg-background text-foreground focus-visible:ring-ring/40 flex size-9 items-center justify-center rounded-full shadow-sm transition outline-none hover:scale-105 focus-visible:ring-[3px] active:scale-95",
        className,
      )}
    >
      <Eye className="size-4" aria-hidden />
    </button>
  );
}
