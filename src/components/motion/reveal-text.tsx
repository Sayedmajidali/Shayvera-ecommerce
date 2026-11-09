import { Fragment } from "react";
import { cn } from "@/lib/utils";

/**
 * Splits a heading into words that rise in one after another.
 * - `trigger="load"`: plays once on page load (hero).
 * - `trigger="view"`: plays when scrolled into view (via RevealObserver).
 * Words stay real text in normal flow, so screen readers, search engines and copy/paste see the
 * plain sentence; with reduced motion or no JavaScript the text is simply shown.
 */
export function RevealText({
  text,
  as: Tag = "h2",
  className,
  trigger = "view",
  delayMs = 0,
}: {
  text: string;
  as?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
  trigger?: "load" | "view";
  delayMs?: number;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <Tag
      className={cn("reveal-words", trigger === "load" && "reveal-words-load", className)}
      data-reveal={trigger === "view" ? "words" : undefined}
      style={{ "--words-delay": `${delayMs}ms` } as React.CSSProperties}
    >
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="rw" style={{ "--w": i } as React.CSSProperties}>
            {w}
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </Tag>
  );
}
