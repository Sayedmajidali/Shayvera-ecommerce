"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Sticky header frame. Adds `data-scrolled` once the page is scrolled (a passive, rAF-throttled
 * listener) so CSS can deepen the background and shadow and compact the logo. The header keeps the
 * same height in both states, so nothing below it moves.
 */
export function HeaderShell({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      ref.current?.toggleAttribute("data-scrolled", window.scrollY > 8);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <header ref={ref} className={cn("group/header", className)}>
      {children}
    </header>
  );
}

/** Desktop category links; the current section is marked for assistive tech and styled. */
export function NavLinks({
  links,
}: {
  links: { href: string; label: string; wideOnly?: boolean }[];
}) {
  const pathname = usePathname();
  return (
    <>
      {links.map((l, i) => {
        const current =
          pathname === l.href || (l.href !== "/shop" && pathname.startsWith(`${l.href}/`));
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "nav-pill hover:bg-accent hover:text-foreground rounded-full px-3.5 py-2 text-sm whitespace-nowrap transition-colors duration-200",
              i === 0 ? "font-medium" : "text-muted-foreground",
              current && "text-foreground bg-accent/60",
              l.wideOnly && "hidden xl:block",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
