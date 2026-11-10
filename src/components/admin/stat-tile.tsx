import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone,
  size = "md",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  href?: string;
  tone?: "warning";
  /** "lg" for the headline figures at the top of the dashboard. */
  size?: "md" | "lg";
}) {
  const body = (
    <div
      className={cn(
        "admin-tile group/tile bg-card relative flex h-full flex-col rounded-2xl border p-5 transition duration-200",
        href && "hover:border-primary/25 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]",
        tone === "warning" && "border-warning/45 bg-[oklch(0.99_0.02_85)]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-[13px] font-medium">{label}</span>
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            tone === "warning"
              ? "bg-warning-soft text-[oklch(0.5_0.12_70)]"
              : "bg-leaf-soft text-primary",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p
        className={cn(
          "mt-3 font-semibold tracking-tight tabular-nums",
          size === "lg" ? "text-[1.85rem] leading-none" : "text-2xl",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{hint}</p>}
      {href && (
        <ArrowUpRight
          className="text-muted-foreground/60 group-hover/tile:text-primary absolute right-4 bottom-4 size-4 opacity-0 transition group-hover/tile:opacity-100"
          aria-hidden
        />
      )}
    </div>
  );
  return href ? (
    <Link
      href={href}
      className="focus-visible:ring-ring/40 rounded-2xl outline-none focus-visible:ring-[3px]"
    >
      {body}
    </Link>
  ) : (
    body
  );
}
