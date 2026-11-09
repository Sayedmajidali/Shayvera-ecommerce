"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Expand } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Img = { url: string; alt: string };

/** Swipe left/right with touch (pointer events; mouse and pen are left to click/zoom). */
function useSwipe(onPrev: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "touch") start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || e.pointerType !== "touch") return;
      const dx = e.clientX - s.x;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - s.y))
        (dx < 0 ? onNext : onPrev)();
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}

function NavButton({
  dir,
  onClick,
  className,
}: {
  dir: "prev" | "next";
  onClick: () => void;
  className?: string;
}) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === "prev" ? "Previous image" : "Next image"}
      className={cn(
        "bg-background/90 hover:bg-background text-foreground focus-visible:ring-ring/40 absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full shadow-sm backdrop-blur transition outline-none hover:scale-105 focus-visible:ring-[3px] active:scale-95",
        dir === "prev" ? "left-3" : "right-3",
        className,
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}

/**
 * Product images: thumbnails, cross-fade between images, hover magnification on desktop, swipe on
 * touch screens, and a fullscreen viewer with previous/next and keyboard navigation.
 */
export function ProductGallery({ images, name }: { images: Img[]; name: string }) {
  const [active, setActive] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const count = images.length;
  const prev = useCallback(() => setActive((i) => (i - 1 + count) % count), [count]);
  const next = useCallback(() => setActive((i) => (i + 1) % count), [count]);
  const swipe = useSwipe(prev, next);
  const current = images[active];

  if (!current) {
    return (
      <div className="bg-muted text-muted-foreground flex aspect-[4/5] items-center justify-center rounded-2xl">
        No image available
      </div>
    );
  }

  return (
    <div className="flex flex-col-reverse items-start gap-4 md:flex-row">
      {count > 1 && (
        <div className="flex gap-3 md:flex-col" role="tablist" aria-label="Product images">
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Show image ${i + 1} of ${count}`}
              onClick={() => setActive(i)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  next();
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  prev();
                }
              }}
              className={cn(
                "relative aspect-[4/5] w-16 overflow-hidden rounded-xl border-2 transition duration-300 hover:-translate-y-0.5 md:w-20",
                i === active
                  ? "border-primary ring-primary/20 ring-4"
                  : "border-transparent opacity-70 hover:opacity-100",
              )}
            >
              <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      <div
        className="group bg-muted shadow-soft relative aspect-[4/5] w-full min-w-0 touch-pan-y overflow-hidden rounded-3xl md:flex-1"
        data-testid="gallery-main"
        {...swipe}
      >
        {/* Magnifier: on fine pointers the image scales 2× around the cursor. */}
        <div
          className="absolute inset-0 [@media(pointer:fine)]:cursor-zoom-in"
          onPointerMove={(e) => {
            if (e.pointerType !== "mouse") return;
            const r = e.currentTarget.getBoundingClientRect();
            setZoom({
              x: ((e.clientX - r.left) / r.width) * 100,
              y: ((e.clientY - r.top) / r.height) * 100,
            });
          }}
          onPointerLeave={() => setZoom(null)}
          onClick={() => setFullscreen(true)}
          aria-hidden
        >
          <Image
            key={current.url}
            src={current.url}
            alt={current.alt || name}
            fill
            priority
            sizes="(min-width: 1024px) 45vw, 100vw"
            className="animate-in fade-in-0 object-cover duration-300 will-change-transform"
            style={{
              transform: zoom ? "scale(2)" : undefined,
              transformOrigin: zoom ? `${zoom.x}% ${zoom.y}%` : undefined,
              transition: "transform 250ms var(--ease-out)",
            }}
          />
        </div>
        {/* Real (non-hidden) image description for assistive technology. */}
        <span className="sr-only">{current.alt || name}</span>
        {count > 1 && (
          <>
            <NavButton
              dir="prev"
              onClick={prev}
              className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
            />
            <NavButton
              dir="next"
              onClick={next}
              className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
            />
            <p className="bg-background/85 absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums backdrop-blur">
              {active + 1} / {count}
            </p>
          </>
        )}
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          aria-label="View images fullscreen"
          className="bg-background/90 hover:bg-background focus-visible:ring-ring/40 absolute right-3 bottom-3 z-10 flex size-10 items-center justify-center rounded-full shadow-sm backdrop-blur transition outline-none hover:scale-105 focus-visible:ring-[3px] active:scale-95"
        >
          <Expand className="size-4" aria-hidden />
        </button>
      </div>

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent
          className="h-dvh max-h-dvh w-screen max-w-none gap-0 rounded-none border-0 bg-black p-0 text-white sm:max-w-none sm:rounded-none [&>button:last-child]:top-4 [&>button:last-child]:right-4 [&>button:last-child]:z-20 [&>button:last-child]:bg-white/10 [&>button:last-child]:p-2 [&>button:last-child]:text-white [&>button:last-child]:opacity-100"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") next();
            else if (e.key === "ArrowLeft") prev();
          }}
          data-testid="gallery-lightbox"
        >
          <DialogTitle className="sr-only">{name} — images</DialogTitle>
          <DialogDescription className="sr-only">
            Use the left and right arrow keys to move between images.
          </DialogDescription>
          <div className="relative flex h-full flex-col" {...swipe}>
            <div className="relative flex-1">
              <Image
                key={current.url}
                src={current.url}
                alt={current.alt || name}
                fill
                sizes="100vw"
                className="animate-in fade-in-0 zoom-in-95 object-contain duration-300"
              />
              {count > 1 && (
                <>
                  <NavButton
                    dir="prev"
                    onClick={prev}
                    className="bg-white/15 text-white hover:bg-white/25"
                  />
                  <NavButton
                    dir="next"
                    onClick={next}
                    className="bg-white/15 text-white hover:bg-white/25"
                  />
                </>
              )}
            </div>
            {count > 1 && (
              <div className="flex items-center justify-center gap-2 p-4">
                {images.map((img, i) => (
                  <button
                    key={img.url}
                    type="button"
                    aria-label={`Show image ${i + 1} of ${count}`}
                    aria-pressed={i === active}
                    onClick={() => setActive(i)}
                    className={cn(
                      "relative aspect-[4/5] w-12 overflow-hidden rounded-lg border-2 transition",
                      i === active
                        ? "border-white"
                        : "border-transparent opacity-50 hover:opacity-90",
                    )}
                  >
                    <Image src={img.url} alt="" fill sizes="48px" className="object-cover" />
                  </button>
                ))}
                <span className="ml-3 text-sm text-white/70 tabular-nums">
                  {active + 1} / {count}
                </span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
