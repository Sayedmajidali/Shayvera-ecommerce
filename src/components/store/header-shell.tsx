"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Sticky header frame. Adds `data-scrolled` once the page is scrolled (a passive, rAF-throttled
 * listener) so CSS can deepen the background and shadow and compact the logo. The header keeps the
 * same height in both states, so nothing below it moves. On mouse devices it also marks
 * `<html data-scrolling>` while the page is moving (see globals.css).
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
    let idle = 0;
    const root = document.documentElement;
    // Mouse devices: while the page is moving, content ignores the pointer so cards sliding under
    // a still cursor don't start hover animations (and the browser skips hit-testing every frame).
    const pauseHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    let scrolled: boolean | null = null;
    const update = () => {
      raf = 0;
      const next = window.scrollY > 8;
      if (next === scrolled) return;
      scrolled = next;
      ref.current?.toggleAttribute("data-scrolled", next);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
      if (!pauseHover) return;
      if (!idle) root.setAttribute("data-scrolling", "");
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        idle = 0;
        root.removeAttribute("data-scrolling");
      }, 150);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
      window.clearTimeout(idle);
      root.removeAttribute("data-scrolling");
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
