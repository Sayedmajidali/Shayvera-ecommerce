import Link from "next/link";
import { cn } from "@/lib/utils";

export function RangeTabs({ current }: { current: string }) {
  return (
    <div
      className="bg-muted inline-flex rounded-full p-1 text-sm"
      role="tablist"
      aria-label="Date range"
    >
      {[
        ["7d", "7 days"],
        ["30d", "30 days"],
        ["90d", "90 days"],
      ].map(([k, l]) => (
        <Link
          key={k}
          href={`/admin?range=${k}`}
          role="tab"
          aria-selected={current === k}
          className={cn(
            "rounded-full px-3.5 py-1.5",
            current === k
              ? "bg-card font-medium shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l}
        </Link>
      ))}
    </div>
  );
}
