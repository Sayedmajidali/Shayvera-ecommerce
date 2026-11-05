import { cn } from "@/lib/utils";

/** FSSAI vegetarian / non-vegetarian symbol (green or brown square with a filled circle). */
export function VegMark({ vegetarian, className }: { vegetarian: boolean; className?: string }) {
  const color = vegetarian ? "#1a8f3c" : "#7a3b14";
  const label = vegetarian ? "Vegetarian" : "Non-vegetarian";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center border-[1.5px] bg-white",
        className,
      )}
      style={{ borderColor: color }}
    >
      <span className="size-2 rounded-full" style={{ background: color }} />
    </span>
  );
}
