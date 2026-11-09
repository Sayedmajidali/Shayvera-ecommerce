"use client";

import { lazy, Suspense, type ReactNode } from "react";
import Link from "next/link";
import { useEnhance } from "@/components/bits/use-enhance";
import { cn } from "@/lib/utils";

/*
 * React Bits components (src/components/react-bits) wired into the store with progressive
 * enhancement: each wrapper renders a plain, accessible version on the server and swaps in the
 * React Bits component — downloaded on demand — only when it is useful (near the viewport, or after
 * the first interaction). Visitors who prefer reduced motion keep the plain versions.
 */

const StarBorder = lazy(() => import("@/components/react-bits/star-border"));
const ShinyText = lazy(() => import("@/components/react-bits/shiny-text"));
const SpotlightCard = lazy(() => import("@/components/react-bits/spotlight-card"));
const TiltedCard = lazy(() => import("@/components/react-bits/tilted-card"));
const LogoLoop = lazy(() => import("@/components/react-bits/logo-loop"));
const ScrollVelocity = lazy(() => import("@/components/react-bits/scroll-velocity"));
const CountUp = lazy(() => import("@/components/react-bits/count-up"));

// Brand colours (from the logo) for components that take explicit colours.
const LEAF = "#a4c848";
const GREEN = "#0c764e";
const SAFFRON = "#cc6824";

/** Primary call-to-action with a light travelling around its border (StarBorder). */
export function StarCta({ href, children }: { href: string; children: ReactNode }) {
  const [ref, on] = useEnhance<HTMLSpanElement>("interaction");
  const plainClass =
    "bg-primary text-primary-foreground inline-flex h-12 items-center gap-2 rounded-full px-7 text-[15px] font-medium shadow-xs transition hover:shadow-[0_10px_24px_-10px_var(--primary)] active:scale-[0.97] [&_svg]:size-4 [&_svg]:transition-transform hover:[&_svg]:translate-x-1";
  const plain = (
    <Link href={href} className={plainClass}>
      {children}
    </Link>
  );
  return (
    <span ref={ref} className="inline-flex">
      {on ? (
        <Suspense fallback={plain}>
          <StarBorder
            as={Link}
            href={href}
            theme="light"
            radius={999}
            thickness={1.5}
            color={LEAF}
            trailColor={SAFFRON}
            backgroundColor={GREEN}
            textColor="#ffffff"
            borderColor="rgba(12,118,78,0.35)"
            duration={5}
            stars={2}
            glow={0.7}
            sparkle
            className="inline-flex h-12 items-center gap-2 px-7 text-[15px] font-medium [&_svg]:size-4"
          >
            {children}
          </StarBorder>
        </Suspense>
      ) : (
        plain
      )}
    </span>
  );
}

/** A soft sheen sweeping across short text (ShinyText). */
export function Shiny({
  text,
  className,
  color = "currentColor",
  shineColor = "#ffffff",
  speed = 3,
}: {
  text: string;
  className?: string;
  color?: string;
  shineColor?: string;
  speed?: number;
}) {
  const [ref, on] = useEnhance<HTMLSpanElement>("near");
  return (
    <span ref={ref} className={className}>
      {on ? (
        <Suspense fallback={text}>
          <ShinyText text={text} color={color} shineColor={shineColor} speed={speed} delay={1.5} />
        </Suspense>
      ) : (
        text
      )}
    </span>
  );
}

/** Card lit by a spotlight that follows the pointer (SpotlightCard). */
export function Spotlight({ className, children }: { className?: string; children: ReactNode }) {
  const [ref, on] = useEnhance<HTMLDivElement>("near");
  const plain = <div className={cn("bg-card rounded-2xl border", className)}>{children}</div>;
  return (
    <div ref={ref} className="h-full">
      {on ? (
        <Suspense fallback={plain}>
          <SpotlightCard
            theme="light"
            spotlightColor="rgba(164, 200, 72, 0.35)"
            intensity={0.9}
            borderGlow={0.8}
            className={cn("h-full rounded-2xl", className)}
          >
            {children}
          </SpotlightCard>
        </Suspense>
      ) : (
        plain
      )}
    </div>
  );
}

/** Category tile that tilts in 3D towards the pointer, with glare (TiltedCard). */
export function TiltTile({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const [ref, on] = useEnhance<HTMLAnchorElement>("near");
  return (
    <Link ref={ref} href={href} className={cn("group block", className)}>
      {on ? (
        <Suspense
          fallback={
            <div className="relative h-full w-full overflow-hidden rounded-3xl">{children}</div>
          }
        >
          <TiltedCard
            containerHeight="100%"
            containerWidth="100%"
            imageHeight="100%"
            imageWidth="100%"
            radius={24}
            rotateAmplitude={9}
            scaleOnHover={1.03}
            showTooltip={false}
            flipOnClick={false}
            gyroscope={false}
            intro={false}
            glare={0.35}
            shadow={0.35}
          >
            {children}
          </TiltedCard>
        </Suspense>
      ) : (
        <div className="relative h-full w-full overflow-hidden rounded-3xl">{children}</div>
      )}
    </Link>
  );
}

export type TrustItem = { label: string; icon: ReactNode };

/** Continuously looping strip of trust badges (LogoLoop). */
export function TrustLoop({ items }: { items: TrustItem[] }) {
  const [ref, on] = useEnhance<HTMLDivElement>("near");
  const badge = (it: TrustItem) => (
    <span className="text-foreground/80 inline-flex items-center gap-2 text-sm font-medium whitespace-nowrap">
      <span className="text-primary [&_svg]:size-5">{it.icon}</span>
      {it.label}
    </span>
  );
  return (
    <div ref={ref} aria-label="Why shop with us" role="region">
      {on ? (
        <Suspense fallback={<StaticTrust items={items} badge={badge} />}>
          <LogoLoop
            logos={items.map((it) => ({ node: badge(it), title: it.label, ariaLabel: it.label }))}
            speed={45}
            gap={56}
            logoHeight={28}
            pauseOnHover
            fadeOut
            fadeOutColor="#fbf8f1"
            ariaLabel="Why shop with us"
          />
        </Suspense>
      ) : (
        <StaticTrust items={items} badge={badge} />
      )}
    </div>
  );
}

function StaticTrust({
  items,
  badge,
}: {
  items: TrustItem[];
  badge: (it: TrustItem) => ReactNode;
}) {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 py-1">
      {items.map((it) => (
        <li key={it.label}>{badge(it)}</li>
      ))}
    </ul>
  );
}

/** Brand ticker that speeds up and skews with scroll velocity (ScrollVelocity); CSS marquee first. */
export function VelocityTicker({ words, fallback }: { words: string; fallback: ReactNode }) {
  const [ref, on] = useEnhance<HTMLDivElement>("interaction");
  return (
    <div ref={ref} className="bg-deep text-deep-foreground overflow-hidden" aria-hidden>
      {on ? (
        <Suspense fallback={fallback}>
          <ScrollVelocity
            texts={[words]}
            velocity={40}
            className="heading-display px-3 text-xl italic sm:text-2xl"
            parallaxClassName="py-4"
            numCopies={6}
            damping={50}
            stiffness={400}
          />
        </Suspense>
      ) : (
        fallback
      )}
    </div>
  );
}

/** A number that counts up when scrolled into view (CountUp); the final value renders first. */
export function StatCount({
  value,
  suffix = "",
  decimals = 0,
  className,
}: {
  value: number;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  const [ref, on] = useEnhance<HTMLSpanElement>("near");
  const text = `${value.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {on ? (
        <Suspense fallback={text}>
          <CountUp
            to={value}
            decimals={decimals}
            suffix={suffix}
            separator=","
            duration={1.6}
            trigger="view"
          />
        </Suspense>
      ) : (
        text
      )}
    </span>
  );
}
