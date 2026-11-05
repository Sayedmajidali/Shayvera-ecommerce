import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function RatingStars({
  rating,
  count,
  className,
}: {
  rating: number;
  count?: number;
  className?: string;
}) {
  const rounded = Math.round(rating * 2) / 2;
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className="flex" role="img" aria-label={`Rated ${rating.toFixed(1)} out of 5`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={cn(
              "size-3.5",
              i <= rounded
                ? "fill-brand text-brand"
                : i - 0.5 === rounded
                  ? "fill-brand/50 text-brand"
                  : "text-border fill-border",
            )}
            aria-hidden
          />
        ))}
      </div>
      {count !== undefined && <span className="text-muted-foreground text-xs">({count})</span>}
    </div>
  );
}
