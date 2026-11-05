import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

export function Price({
  paise,
  compareAtPaise,
  className,
  size = "md",
  from = false,
}: {
  paise: number;
  compareAtPaise?: number | null;
  className?: string;
  size?: "sm" | "md" | "lg";
  from?: boolean;
}) {
  const discount =
    compareAtPaise && compareAtPaise > paise
      ? Math.round(((compareAtPaise - paise) / compareAtPaise) * 100)
      : 0;
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
      <span
        className={cn(
          "font-semibold tabular-nums",
          size === "lg" && "text-2xl",
          size === "md" && "text-[15px]",
          size === "sm" && "text-sm",
        )}
      >
        {from && <span className="text-muted-foreground mr-1 text-xs font-normal">from</span>}
        {formatINR(paise)}
      </span>
      {discount > 0 && (
        <>
          <span className="text-muted-foreground text-sm tabular-nums line-through">
            <span className="sr-only">Original price </span>
            {formatINR(compareAtPaise!)}
          </span>
          <span className="text-brand text-xs font-semibold">{discount}% off</span>
        </>
      )}
    </div>
  );
}
