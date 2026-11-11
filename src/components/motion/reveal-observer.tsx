"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * One IntersectionObserver for the whole storefront: elements marked `data-reveal` (or the children
 * of a `data-reveal-stagger` container) fade/slide in once, the first time they scroll into view.
 *
 * Fail-safe by design: content is only hidden after this script has marked it `data-reveal-pending`,
 * so with JavaScript off, before hydration, for late-streamed content or with reduced motion, it is
 * simply visible. Elements already on screen when the page loads are never hidden (no delay to the
 * first paint). Each element animates at most once.
 */
const SELECTOR = "[data-reveal], [data-reveal-stagger] > *";
const STAGGER_MS = 70;
const MAX_STAGGER = 6;

export function RevealObserver() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    const root = document.getElementById("main");
    if (!root) return;

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) =>
              a.boundingClientRect.top - b.boundingClientRect.top ||
              a.boundingClientRect.left - b.boundingClientRect.left,
          );
        visible.forEach((e, i) => {
          const el = e.target as HTMLElement;
          io.unobserve(el);
          const own = Number(el.dataset.revealDelay ?? 0);
          el.style.setProperty(
            "--reveal-delay",
            `${own + Math.min(i, MAX_STAGGER) * STAGGER_MS}ms`,
          );
          el.removeAttribute("data-reveal-pending");
          el.classList.add("is-revealing");
        });
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.12 },
    );

    const scan = () => {
      const vh = window.innerHeight;
      for (const el of root.querySelectorAll<HTMLElement>(SELECTOR)) {
        if (el.dataset.revealSeen) continue;
        el.dataset.revealSeen = "1";
        const r = el.getBoundingClientRect();
        if (r.top < vh && r.bottom > 0) continue; // already on screen: leave as is
        el.setAttribute("data-reveal-pending", "");
        io.observe(el);
      }
    };
    scan();

    // Content streamed in after the first commit (Suspense) is picked up too.
    let raf = 0;
    // Only additions that can hold reveal targets trigger a re-scan (not, e.g., text updates from
    // counters or effects rewriting their own markup on every frame).
    const relevant = (records: MutationRecord[]) =>
      records.some((record) =>
        Array.from(record.addedNodes).some(
          (node) =>
            node instanceof Element &&
            (node.matches(SELECTOR) ||
              node.querySelector("[data-reveal], [data-reveal-stagger]") !== null),
        ),
      );
    const mo = new MutationObserver((records) => {
      if (raf || !relevant(records)) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        scan();
      });
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      io.disconnect();
      // Anything still waiting becomes visible (e.g. when navigating away mid-scroll).
      for (const el of root.querySelectorAll("[data-reveal-pending]"))
        el.removeAttribute("data-reveal-pending");
    };
  }, [pathname]);

  return null;
}
