import Image from "next/image";
import { CERTIFICATIONS, SITE_IMAGE_SLOTS } from "@/lib/site-images";
import { getSiteImages } from "@/server/modules/settings/site-images";
import { cn } from "@/lib/utils";

/**
 * Certifications strip: round logo tiles with names. Every logo is a site image slot, so staff can
 * replace a built-in badge with the official logo file in Admin → Site images.
 */
export async function Certifications({
  className,
  bare = false,
}: {
  className?: string;
  /** Already inside a page container: don't add another. */
  bare?: boolean;
}) {
  const images = await getSiteImages();
  const items = CERTIFICATIONS.map((c) => {
    const uploaded = images[c.slot];
    const fallback = SITE_IMAGE_SLOTS.find((s) => s.slot === c.slot)?.defaultUrl ?? "";
    return { ...c, src: uploaded?.url ?? fallback, alt: uploaded?.alt || `${c.name} logo` };
  });
  return (
    <section aria-labelledby="certifications-title" className={cn("py-16", className)}>
      <div className={cn("text-center", !bare && "container-page")}>
        <p className="text-brand text-xs font-semibold tracking-[0.2em] uppercase">
          Quality you can trust
        </p>
        <h2 id="certifications-title" className="heading-display mt-2 text-3xl sm:text-4xl">
          Our certifications
        </h2>
        <ul
          data-reveal-stagger
          className="mx-auto mt-10 flex max-w-5xl flex-wrap justify-center gap-x-[5%] gap-y-8 sm:gap-x-[4%] lg:gap-x-[2%]"
        >
          {items.map((c) => (
            <li key={c.slot} className="flex w-[30%] max-w-28 flex-col items-center gap-3 sm:w-[22%] lg:w-[10.5%]">
              <span className="bg-background ring-border/60 grid aspect-square w-full place-items-center overflow-hidden rounded-full shadow-[0_8px_24px_-14px_oklch(0.3_0.06_165/0.35)] ring-1 transition-transform duration-300 hover:-translate-y-1">
                <Image
                  src={c.src}
                  alt={c.alt}
                  width={112}
                  height={112}
                  unoptimized={c.src.endsWith(".svg")}
                  className="size-full object-contain"
                />
              </span>
              <span className="text-foreground/80 text-xs leading-tight font-medium sm:text-[13px]">
                {c.name}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
