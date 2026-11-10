"use client";

import { useEffect, useRef, useState } from "react";

export type EnhanceWhen = "near" | "interaction" | "always";

/**
 * Progressive enhancement switch for the React Bits components.
 * The plain, server-rendered version is shown first; this flips to `true` when the richer
 * (lazily downloaded) component should take over:
 * - "near": the element is within ~500px of the viewport;
 * - "interaction": the visitor first scrolls, moves the pointer, touches or types;
 * - "always": right after hydration.
 * With `decorative` (default) visitors who prefer reduced motion keep the plain version.
 * With `finePointer`, touch devices (phones, tablets) also keep the plain version: used for effects
 * that react to a mouse, or that do per-frame JavaScript work which would compete with touch scrolling.
 */
export function useEnhance<T extends HTMLElement>(
  when: EnhanceWhen = "near",
  decorative = true,
  opts: { finePointer?: boolean } = {},
) {
  const finePointer = opts.finePointer ?? false;
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (decorative && !window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    if (finePointer && !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (when === "always") {
      const t = setTimeout(() => setOn(true), 0);
      return () => clearTimeout(t);
    }
    if (when === "interaction") {
      const events = ["scroll", "pointermove", "touchstart", "keydown"] as const;
      const go = () => {
        setOn(true);
        events.forEach((e) => window.removeEventListener(e, go));
      };
      events.forEach((e) => window.addEventListener(e, go, { passive: true, once: true }));
      return () => events.forEach((e) => window.removeEventListener(e, go));
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setOn(true);
          io.disconnect();
        }
      },
      { rootMargin: "500px 0px 500px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [when, decorative, finePointer]);

  return [ref, on] as const;
}
