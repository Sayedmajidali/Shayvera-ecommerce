"use client";

import { lazy, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEnhance } from "@/components/bits/use-enhance";

const Masonry = lazy(() => import("@/components/react-bits/masonry"));

export type PantryPhoto = { slug: string; name: string; img: string; alt: string; tall?: boolean };

/** Optimised URL for an uploaded product photo (Next.js image optimiser). */
const optimised = (url: string, w: number) =>
  `/_next/image?url=${encodeURIComponent(url)}&w=${w}&q=75`;

/**
 * "From our pantry" — real product photos in a masonry layout (React Bits Masonry). Each tile opens
 * its product. A simple CSS-columns grid of the same links renders first and without JavaScript.
 */
export function PantryGallery({ photos }: { photos: PantryPhoto[] }) {
  const router = useRouter();
  // Content, not decoration: upgrade near the viewport even with reduced motion (Masonry respects it).
  const [ref, on] = useEnhance<HTMLDivElement>("near", false);

  const fallback = (
    <ul className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>li]:mb-3">
      {photos.map((p) => (
        <li key={p.slug} className="break-inside-avoid">
          <Link
            href={`/product/${p.slug}`}
            className="group bg-muted relative block overflow-hidden rounded-2xl"
            style={{ aspectRatio: p.tall ? "4 / 5.4" : "4 / 4.2" }}
          >
            <Image
              src={p.img}
              alt={p.alt || p.name}
              fill
              sizes="(min-width: 1024px) 25vw, 50vw"
              className="zoom-img object-cover"
            />
            <span className="from-deep/70 absolute inset-x-0 bottom-0 bg-gradient-to-t to-transparent p-3 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
              {p.name}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div ref={ref}>
      {on ? (
        <Suspense fallback={fallback}>
          <Masonry
            items={photos.map((p) => ({
              id: p.slug,
              img: optimised(p.img, 640),
              width: 400,
              height: p.tall ? 540 : 420,
              title: p.name,
              alt: p.alt || p.name,
            }))}
            columns="auto"
            columnWidth={250}
            gap={12}
            radius={18}
            animateFrom="bottom"
            hoverEffect="zoom"
            captions="hover"
            lightbox={false}
            draggable={false}
            onItemClick={(item) => router.push(`/product/${String(item.id)}`)}
          />
        </Suspense>
      ) : (
        fallback
      )}
    </div>
  );
}
