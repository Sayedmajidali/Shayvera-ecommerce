import { Check } from "lucide-react";
import type { OrderStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { ORDER_STATUS_LABEL } from "@/server/modules/orders/order-status";

const fmt = (d: Date) =>
  d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });

/** Chronological status history (customer-safe: status and time only, never staff notes). */
export function OrderTimeline({
  history,
  className,
}: {
  history: { toStatus: OrderStatus; createdAt: Date }[];
  className?: string;
}) {
  if (history.length === 0) return null;
  const latest = history.length - 1;
  return (
    <ol
      className={cn("grid gap-0", className)}
      aria-label="Order timeline"
      data-testid="order-timeline"
    >
      {history.map((h, i) => (
        <li key={`${h.toStatus}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
          {i < latest && (
            <span className="bg-border absolute top-6 left-[11px] h-full w-px" aria-hidden />
          )}
          <span
            className={cn(
              "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full",
              i === latest
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Check className="size-3.5" aria-hidden />
          </span>
          <div className="text-sm">
            <p className={i === latest ? "font-medium" : undefined}>
              {ORDER_STATUS_LABEL[h.toStatus]}
            </p>
            <p className="text-muted-foreground text-xs">
              <time dateTime={h.createdAt.toISOString()}>{fmt(h.createdAt)}</time>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
