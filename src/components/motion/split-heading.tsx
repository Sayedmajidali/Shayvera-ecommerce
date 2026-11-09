"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { SplitTextEffect } from "@/components/react-bits/split-text";
import { cn } from "@/lib/utils";

// GSAP (+ SplitText/ScrollTrigger) is ~50 KB: fetch it only when a split heading is about to be seen.
const SplitText = lazy(() => import("@/components/react-bits/split-text"));

type Tag = "h1" | "h2" | "h3" | "p";

/**
 * A heading animated with React Bits' SplitText — progressively enhanced:
 * the plain heading is server-rendered and always readable; the animated version is loaded
 * ~400px before the heading scrolls into view. Headings already on screen at load, and visitors
 * who prefer reduced motion, keep the plain text (and never download GSAP).
 */
export function SplitHeading({
  text,
  as = "h2",
  className,
  splitType = "chars",
  effect = "rise",
  textAlign = "left",
  delay = 30,
}: {
  text: string;
  as?: Tag;
  className?: string;
  splitType?: "chars" | "words" | "lines" | "words, chars";
  effect?: SplitTextEffect;
  textAlign?: "left" | "center" | "right";
  delay?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const [enhanced, setEnhanced] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // already visible: stay static
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setEnhanced(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px 400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Plain = as;
  const plain = (
    <Plain ref={ref as React.Ref<never>} className={className} style={{ textAlign }}>
      {text}
    </Plain>
  );
  if (!enhanced) return plain;
  return (
    <Suspense fallback={plain}>
      <SplitText
        text={text}
        tag={as}
        // SplitText clips rising letters (overflow: hidden); room for descenders like "y" and "g".
        className={cn("pb-[0.14em]", className)}
        splitType={splitType}
        effect={effect}
        textAlign={textAlign}
        delay={delay}
        duration={0.9}
        threshold={0.15}
        rootMargin="-40px"
      />
    </Suspense>
  );
}
