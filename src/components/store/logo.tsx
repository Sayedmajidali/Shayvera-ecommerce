import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "heading-display inline-flex items-baseline gap-1.5 text-2xl font-medium tracking-tight",
        className,
      )}
      aria-label="Shayvera Foods home"
    >
      <span>
        Shayvera<span className="text-brand">.</span>
      </span>
      <span className="text-muted-foreground font-sans text-[0.55em] font-medium tracking-[0.2em] uppercase">
        Foods
      </span>
    </Link>
  );
}
