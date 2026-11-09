"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

export function ProductGallery({
  images,
  name,
}: {
  images: { url: string; alt: string }[];
  name: string;
}) {
  const [active, setActive] = useState(0);
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
      {images.length > 1 && (
        <div className="flex gap-3 md:flex-col" role="tablist" aria-label="Product images">
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Show image ${i + 1} of ${images.length}`}
              onClick={() => setActive(i)}
              className={cn(
                "relative aspect-[4/5] w-16 overflow-hidden rounded-xl border-2 transition duration-300 hover:-translate-y-0.5 md:w-20",
                i === active ? "border-primary" : "border-transparent opacity-70 hover:opacity-100",
              )}
            >
              <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="group bg-muted shadow-soft relative aspect-[4/5] w-full min-w-0 overflow-hidden rounded-3xl md:flex-1">
        <Image
          key={current.url}
          src={current.url}
          alt={current.alt || name}
          fill
          priority
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="animate-in fade-in-0 zoom-img object-cover duration-300"
        />
      </div>
    </div>
  );
}
