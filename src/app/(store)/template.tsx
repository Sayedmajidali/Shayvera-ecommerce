"use client";

import { useEffect } from "react";

let navigated = false;

/**
 * Re-mounted on every store navigation. The first page renders as-is (no fade delaying the first
 * paint); every page after that fades in with a CSS animation (.page-enter in globals.css).
 *
 * This replaces a React <ViewTransition> around the page: that also animated in-page Suspense
 * reveals (effects loading as the visitor scrolls), snapshotting and cross-fading the whole page
 * mid-scroll, which made scrolling stutter.
 */
export default function StoreTemplate({ children }: { children: React.ReactNode }) {
  const animate = navigated;
  useEffect(() => {
    navigated = true;
  }, []);
  return <div className={animate ? "page-enter" : undefined}>{children}</div>;
}
