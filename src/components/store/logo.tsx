import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { getSiteImages } from "@/server/modules/settings/site-images";

/**
 * Shayvera lotus mark + wordmark (vector, traced from the brand logo; /public/brand).
 * `tone="light"` renders both in ivory for dark backgrounds.
 * An uploaded logo (Admin → Site images) replaces both; on dark backgrounds it sits on a light chip
 * so its own colours stay true.
 */
export async function Logo({
  className,
  href = "/",
  tone = "brand",
  size = "md",
}: {
  className?: string;
  href?: string;
  tone?: "brand" | "light";
  size?: "md" | "lg";
}) {
  const custom = (await getSiteImages()).logo;
  if (custom) {
    const h = size === "lg" ? 52 : 40;
    return (
      <Link
        href={href}
        className={cn(
          "inline-flex shrink-0 items-center",
          tone === "light" && "rounded-xl bg-white/95 px-3 py-2",
          className,
        )}
        aria-label="Shayvera Food home"
      >
        <Image
          src={custom.url}
          alt=""
          width={Math.round((h * custom.width) / custom.height)}
          height={h}
          priority
          sizes={`${Math.round((h * 2 * custom.width) / custom.height)}px`}
          style={{ height: h, width: "auto" }}
        />
      </Link>
    );
  }
  const light = tone === "light" ? "brightness-0 invert" : "";
  const markH = size === "lg" ? 52 : 38;
  const wordH = size === "lg" ? 22 : 17;
  return (
    <Link
      href={href}
      className={cn("group/logo inline-flex shrink-0 items-center gap-2", className)}
      aria-label="Shayvera Food home"
    >
      <Image
        src="/brand/mark.svg"
        alt=""
        width={Math.round((markH * 440) / 296)}
        height={markH}
        unoptimized
        loading="eager"
        className={cn(
          "transition-transform duration-500 ease-[var(--ease-spring)] group-hover/logo:-translate-y-0.5 group-hover/logo:rotate-[-4deg]",
          light,
        )}
        style={{ height: markH, width: "auto" }}
      />
      <span className="flex flex-col leading-none">
        <Image
          src="/brand/wordmark.svg"
          alt=""
          width={Math.round((wordH * 902) / 134)}
          height={wordH}
          unoptimized
          loading="eager"
          className={light}
          style={{ height: wordH, width: "auto" }}
        />
        <span
          className={cn(
            "mt-1 text-[9px] font-semibold tracking-[0.32em] uppercase",
            tone === "light" ? "text-deep-foreground/70" : "text-brand",
          )}
        >
          Food
        </span>
      </span>
    </Link>
  );
}
