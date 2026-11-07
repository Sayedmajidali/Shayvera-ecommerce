import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  as: Heading = "h2",
}: {
  /** Heading level of the title: h2 inside a page, h1 when the empty state is the whole page. */
  as?: "h1" | "h2";
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-card/50 flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-16 text-center",
        className,
      )}
    >
      <div className="bg-brand-soft text-brand flex size-14 items-center justify-center rounded-full">
        <Icon className="size-6" aria-hidden />
      </div>
      <Heading className="mt-5 text-lg font-semibold">{title}</Heading>
      {description && <p className="text-muted-foreground mt-2 max-w-sm text-sm">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
