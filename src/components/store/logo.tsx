import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn("heading-display text-2xl font-medium tracking-tight", className)}
      aria-label="Shayvera home"
    >
      Shayvera<span className="text-brand">.</span>
    </Link>
  );
}
