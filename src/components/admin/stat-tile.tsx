import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  href?: string;
  tone?: "warning";
}) {
  const body = (
    <div
      className={cn(
        "bg-card shadow-soft flex h-full flex-col rounded-xl border p-5 transition",
        href && "hover:border-foreground/20",
        tone === "warning" && "border-warning/50",
      )}
    >
      <div className="text-muted-foreground flex items-center justify-between text-sm">
        {label}
        <Icon className="size-4" aria-hidden />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
