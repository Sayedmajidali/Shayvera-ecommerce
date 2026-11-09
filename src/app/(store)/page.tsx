import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  CreditCard,
  Landmark,
  Leaf,
  MapPin,
  PackageCheck,
  Quote,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewsletterForm } from "@/components/store/newsletter-form";
import { ProductGrid } from "@/components/store/product-card";
import { SplitHeading } from "@/components/motion/split-heading";
import {
  Shiny,
  Spotlight,
  StarCta,
  TiltTile,
  TrustLoop,
  VelocityTicker,
  type TrustItem,
} from "@/components/bits/enhanced";
import { PantryGallery, type PantryPhoto } from "@/components/bits/pantry-gallery";
import { RatingStars } from "@/components/store/rating-stars";
import { formatINR } from "@/lib/money";
import { getHomeData } from "@/server/modules/catalog/queries";
import { getStoreSettings } from "@/server/modules/settings/queries";
import { getSiteImages } from "@/server/modules/settings/site-images";
import { siteConfig } from "@/lib/site";
import type { Metadata } from "next";

export const metadata: Metadata = { alternates: { canonical: "/" } };

function SectionHeading({
  eyebrow,
  title,
  href,
  cta,
}: {
  eyebrow: string;
  title: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div data-reveal className="mb-8 flex items-end justify-between gap-4 sm:mb-10">
      <div>
        <p className="text-brand flex items-center gap-2 text-xs font-semibold tracking-[0.22em] uppercase">
          <span className="bg-leaf h-px w-6" aria-hidden />
          {eyebrow}
        </p>
        <h2 className="heading-display mt-2 text-3xl sm:text-[2.6rem] sm:leading-tight">{title}</h2>
      </div>
      {href && (
        <Link
          href={href}
          className="group text-primary hidden items-center gap-1.5 text-sm font-semibold sm:flex"
        >
          <span className="link-draw">{cta ?? "View all"}</span>
          <span className="bg-primary/10 group-hover:bg-primary group-hover:text-primary-foreground flex size-7 items-center justify-center rounded-full transition-colors duration-300">
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
          </span>
        </Link>
      )}
    </div>
  );
}

const TICKER = ["Spices", "Dry fruits", "Makhana", "Herbal", "Food", "Nuts", "Masalas"];

/** CSS marquee shown first; upgraded to React Bits ScrollVelocity on the first scroll. */
function Ticker() {
  return <VelocityTicker words={TICKER.join(" · ") + " ·"} fallback={<CssTicker />} />;
}

function CssTicker() {
  const items = [...TICKER, ...TICKER];
  return (
    <div className="marquee-wrap overflow-hidden py-4">
      <div className="marquee">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center">
            {items.map((t, i) => (
              <span
                key={`${copy}-${i}`}
                className="heading-display flex items-center gap-6 px-6 text-xl whitespace-nowrap italic sm:text-2xl"
              >
                {t}
                <Image
                  src="/brand/mark.svg"
                  alt=""
                  width={30}
                  height={20}
                  unoptimized
                  className="h-5 w-auto opacity-80 brightness-0 invert"
                />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function HomePage() {
  const [{ categories, featured, bestsellers, newArrivals, testimonials }, settings, site] =
    await Promise.all([getHomeData(), getStoreSettings(), getSiteImages()]);
  // Admin → Site images can replace the hero photos; otherwise featured product photos are used.
  const productHero = featured.flatMap((p) => p.images.slice(0, 1)).slice(0, 2);
  const heroImages = [
    site.heroPrimary
      ? { url: site.heroPrimary.url, alt: site.heroPrimary.alt || "Shayvera Foods" }
      : productHero[0],
    site.heroSecondary
      ? { url: site.heroSecondary.url, alt: site.heroSecondary.alt || "Shayvera Foods" }
      : productHero[1],
  ];
  const featuredCategories = categories.filter((c) => c.isFeatured).slice(0, 4);
  // Real product photos for the "From our pantry" gallery (one per product, no duplicates).
  const seen = new Set<string>();
  const pantry: PantryPhoto[] = [...featured, ...bestsellers, ...newArrivals]
    .filter((p) => p.images[0] && !seen.has(p.slug) && seen.add(p.slug))
    .slice(0, 10)
    .map((p, i) => ({
      slug: p.slug,
      name: p.name,
      img: p.images[0]!.url,
      alt: p.images[0]!.alt,
      tall: i % 3 === 0,
    }));
  // Only claims the store can stand behind, driven by its settings.
  const trust: TrustItem[] = [
    { label: "Secure payments by Razorpay", icon: <ShieldCheck /> },
    { label: "UPI", icon: <Smartphone /> },
    { label: "Credit & debit cards", icon: <CreditCard /> },
    { label: "Net banking", icon: <Landmark /> },
    ...(settings.codEnabled ? [{ label: "Cash on Delivery", icon: <Banknote /> }] : []),
    ...(settings.freeShippingThresholdPaise !== null
      ? [
          {
            label: `Free shipping over ${formatINR(settings.freeShippingThresholdPaise)}`,
            icon: <Truck />,
          },
        ]
      : []),
    ...(settings.fssaiLicense ? [{ label: "FSSAI licensed", icon: <BadgeCheck /> }] : []),
    { label: "Hygienically packed", icon: <PackageCheck /> },
    { label: "Ships across India", icon: <MapPin /> },
  ];

  return (
    <>
      {/* Hero */}
      <section className="bg-aura relative overflow-hidden">
        <Image
          src="/brand/mark.svg"
          alt=""
          width={440}
          height={296}
          unoptimized
          className="parallax-slow pointer-events-none absolute -top-10 -left-24 hidden w-[420px] opacity-[0.05] select-none lg:block"
        />
        <div
          className="parallax-slow bg-leaf/20 pointer-events-none absolute top-1/3 right-[8%] hidden size-72 rounded-full blur-3xl lg:block"
          aria-hidden
        />
        <div className="container-page grid items-center gap-12 pt-10 pb-16 sm:pt-14 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-24">
          <div>
            <p className="animate-fade-up border-primary/15 bg-card/70 text-primary inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-[0.2em] uppercase backdrop-blur">
              <span className="bg-leaf size-1.5 rounded-full" aria-hidden />
              Spices · Dry fruits · Makhana · Herbal
            </p>
            <h1 className="reveal-words reveal-words-load heading-display mt-6 text-[2.75rem] leading-[1.04] sm:text-6xl xl:text-7xl">
              <span className="rw" style={{ "--w": 0 } as React.CSSProperties}>
                Rooted in trust,
              </span>{" "}
              <span className="rw relative" style={{ "--w": 3 } as React.CSSProperties}>
                <em className="text-brand not-italic">crafted with care.</em>
                <svg
                  viewBox="0 0 300 20"
                  preserveAspectRatio="none"
                  className="text-leaf absolute -bottom-2 left-0 h-3 w-full"
                  aria-hidden
                >
                  <path
                    d="M3 14 C 70 4, 150 4, 297 11"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="5"
                    strokeLinecap="round"
                    pathLength={1}
                    className="draw-line"
                  />
                </svg>
              </span>
            </h1>
            <p
              className="animate-fade-up text-muted-foreground mt-7 max-w-lg text-lg leading-8"
              style={{ animationDelay: "380ms" }}
            >
              Simple, authentic food made from ingredients we can trust — carefully selected,
              processed with care and hygienically packed for Indian kitchens.
            </p>
            <div
              className="animate-fade-up mt-8 flex flex-wrap gap-3"
              style={{ animationDelay: "500ms" }}
            >
              <StarCta href="/shop">
                Shop the pantry <ArrowRight />
              </StarCta>
              <Button asChild size="lg" variant="outline">
                <Link href="/about">Our promise</Link>
              </Button>
            </div>
            <ul
              className="animate-fade-up text-muted-foreground mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm"
              style={{ animationDelay: "620ms" }}
            >
              {[
                "Hygienically packed",
                "Carefully sourced",
                settings.codEnabled ? "Cash on Delivery" : "Secure payments",
              ].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span className="bg-primary/10 text-primary flex size-5 items-center justify-center rounded-full">
                    <Check className="size-3" aria-hidden />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative mx-auto grid w-full max-w-xl grid-cols-5 gap-4">
            {heroImages[0] && (
              <div className="shadow-lift relative col-span-3 aspect-[4/5] overflow-hidden rounded-t-[999px] rounded-b-3xl">
                <Image
                  src={heroImages[0].url}
                  alt={heroImages[0].alt}
                  fill
                  priority
                  sizes="(min-width: 1024px) 30vw, 60vw"
                  className="parallax object-cover"
                />
              </div>
            )}
            {heroImages[1] && (
              <div className="col-span-2 mt-20 flex flex-col gap-4">
                <div className="shadow-lift relative aspect-square overflow-hidden rounded-full">
                  <Image
                    src={heroImages[1].url}
                    alt={heroImages[1].alt}
                    fill
                    priority
                    sizes="(min-width: 1024px) 20vw, 40vw"
                    className="parallax object-cover"
                  />
                </div>
                <div className="bg-card shadow-soft animate-float rounded-2xl border p-4 [animation-delay:-3s]">
                  <Image
                    src="/brand/mark.svg"
                    alt=""
                    width={45}
                    height={30}
                    unoptimized
                    className="h-7 w-auto"
                  />
                  <p className="mt-2 text-sm leading-snug font-semibold">
                    What we wouldn’t feed our own family, we won’t sell to yours.
                  </p>
                </div>
              </div>
            )}
            <div
              className="bg-leaf/25 absolute -right-6 -bottom-6 -z-10 size-40 rounded-full blur-2xl"
              aria-hidden
            />
          </div>
        </div>
      </section>

      <Ticker />

      {/* Value props */}
      <section className="container-page py-14">
        <div data-reveal-stagger className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {[
            {
              icon: Truck,
              title: "Free shipping",
              text:
                settings.freeShippingThresholdPaise !== null
                  ? `On orders above ${formatINR(settings.freeShippingThresholdPaise)}`
                  : "Fast delivery across India",
            },
            {
              icon: ShieldCheck,
              title: "Secure payments",
              text: settings.codEnabled
                ? "UPI, cards & Cash on Delivery"
                : "UPI, cards & netbanking",
            },
            {
              icon: RotateCcw,
              title: "Freshness promise",
              text: "Damaged or wrong item? We replace it",
            },
            {
              icon: Leaf,
              title: "Hygienically packed",
              text: "Sourced responsibly, processed carefully",
            },
          ].map(({ icon: Icon, title, text }) => (
            <Spotlight
              key={title}
              className="group flex flex-col items-start gap-3 p-4 sm:flex-row sm:p-5"
            >
              <div className="bg-leaf-soft text-primary group-hover:bg-primary group-hover:text-primary-foreground flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors duration-300">
                <Icon
                  className="size-5 transition-transform duration-500 group-hover:-rotate-12"
                  aria-hidden
                />
              </div>
              <div>
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-muted-foreground mt-0.5 text-sm leading-snug">{text}</p>
              </div>
            </Spotlight>
          ))}
        </div>
      </section>

      {/* Featured categories */}
      {featuredCategories.length > 0 && (
        <section className="container-page pt-6 pb-20">
          <SectionHeading
            eyebrow="Explore"
            title="Shop by category"
            href="/shop"
            cta="All products"
          />
          <div data-reveal-stagger className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {featuredCategories.map((c) => (
              <TiltTile
                key={c.slug}
                href={`/category/${c.slug}`}
                className="bg-muted relative aspect-[4/5] rounded-3xl"
              >
                {c.imageUrl && (
                  <Image
                    src={c.imageUrl}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 24vw, 48vw"
                    className="zoom-img object-cover"
                  />
                )}
                <div className="from-deep/85 via-deep/10 absolute inset-0 bg-gradient-to-t to-transparent transition-opacity duration-500 group-hover:opacity-90" />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4 text-white sm:p-5">
                  <div className="transition-transform duration-500 ease-[var(--ease-out)] group-hover:-translate-y-1">
                    <h3 className="heading-display text-xl sm:text-2xl">{c.name}</h3>
                    <p className="mt-1 text-sm text-white/80">
                      {c._count.products} products
                      <span className="ml-1.5 inline-block -translate-x-1 opacity-0 transition duration-300 group-hover:translate-x-0 group-hover:opacity-100">
                        · Explore
                      </span>
                    </p>
                  </div>
                  <span className="group-hover:bg-brand flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 backdrop-blur transition-[background-color,transform] duration-300 group-hover:-rotate-45">
                    <ArrowRight className="size-4" aria-hidden />
                  </span>
                </div>
              </TiltTile>
            ))}
          </div>
        </section>
      )}

      {/* Featured products */}
      {featured.length > 0 && (
        <section className="container-page pb-20">
          <SectionHeading eyebrow="Curated" title="Our favourites" href="/shop?sort=featured" />
          <ProductGrid products={featured.slice(0, 8)} />
        </section>
      )}

      {/* Promo banner */}
      <section className="container-page pb-20">
        <div
          data-reveal
          className="bg-deep-aura text-deep-foreground relative overflow-hidden rounded-[2rem] px-6 py-14 sm:px-12 lg:px-16"
        >
          {site.promoBanner && (
            <>
              <Image
                src={site.promoBanner.url}
                alt=""
                fill
                sizes="(min-width: 1280px) 1216px, 100vw"
                className="object-cover"
              />
              {/* Keeps the offer text legible over any photo. */}
              <div className="from-deep/95 via-deep/80 to-deep/40 absolute inset-0 bg-gradient-to-r" />
            </>
          )}
          <Image
            src="/brand/mark.svg"
            alt=""
            width={440}
            height={296}
            unoptimized
            className="animate-float pointer-events-none absolute -right-16 -bottom-20 w-80 opacity-10 brightness-0 invert select-none sm:w-[26rem]"
          />
          <div className="relative grid gap-8 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-leaf text-xs font-semibold tracking-[0.25em] uppercase">
                Welcome offer
              </p>
              <SplitHeading
                text="10% off your first order"
                className="heading-display mt-3 text-4xl sm:text-5xl"
                splitType="chars"
                effect="rise"
              />
              <p className="mt-4 max-w-md text-white/75">
                Use code{" "}
                <span className="rounded-md border border-dashed border-white/40 bg-white/10 px-2 py-0.5 font-mono font-semibold text-white">
                  <Shiny text="WELCOME10" color="#ffffff" shineColor="#d9ee9c" />
                </span>{" "}
                at checkout on orders above ₹999.
              </p>
            </div>
            <div className="lg:justify-self-end">
              <Button asChild size="lg" variant="brand">
                <Link href="/shop">
                  Start shopping <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Bestsellers & new arrivals */}
      <section className="container-page pb-20">
        <SectionHeading eyebrow="Loved by many" title="Bestsellers" href="/shop?sort=bestselling" />
        <ProductGrid products={bestsellers} />
      </section>
      <section className="container-page pb-20">
        <SectionHeading eyebrow="Just landed" title="New arrivals" href="/shop?sort=newest" />
        <ProductGrid products={newArrivals} />
      </section>

      {/* From our pantry (React Bits Masonry) */}
      {pantry.length >= 4 && (
        <section className="container-page pb-20">
          <SectionHeading
            eyebrow="From our pantry"
            title="A closer look"
            href="/shop"
            cta="Shop all"
          />
          <PantryGallery photos={pantry} />
        </section>
      )}

      {/* Trust strip (React Bits LogoLoop) */}
      <section className="border-y py-6">
        <TrustLoop items={trust} />
      </section>

      {/* Testimonials */}
      {testimonials.length > 0 && (
        <section className="bg-card border-y py-20">
          <div className="container-page">
            <SectionHeading eyebrow="Kind words" title="From our customers" />
            <div data-reveal-stagger className="grid gap-5 md:grid-cols-3">
              {testimonials.map((t) => (
                <figure
                  key={t.id}
                  className="lift bg-background hover:border-primary/20 relative flex flex-col overflow-hidden rounded-3xl border p-7"
                >
                  <Quote
                    className="text-leaf/30 absolute -top-2 -right-2 size-24 rotate-12"
                    aria-hidden
                  />
                  <Quote className="text-brand size-6" aria-hidden />
                  <RatingStars rating={t.rating} className="mt-4" />
                  <blockquote className="mt-3 flex-1 text-[15px] leading-7">
                    {t.title && <p className="font-medium">{t.title}</p>}
                    <p className="text-muted-foreground">{t.body}</p>
                  </blockquote>
                  <figcaption className="mt-6 border-t pt-4 text-sm">
                    <span className="font-medium">{t.user.name}</span>
                    <span className="text-muted-foreground"> on </span>
                    <Link href={`/product/${t.product.slug}`} className="link-draw text-primary">
                      {t.product.name}
                    </Link>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Newsletter */}
      <section className="container-page pt-20">
        <div
          data-reveal
          className="bg-leaf-soft/60 border-leaf/30 relative mx-auto max-w-4xl overflow-hidden rounded-[2rem] border px-6 py-12 text-center sm:px-12"
        >
          <Image
            src="/brand/mark.svg"
            alt=""
            width={66}
            height={44}
            unoptimized
            className="mx-auto h-11 w-auto"
          />
          <SplitHeading
            text="Recipes & offers from our kitchen"
            className="heading-display mt-4 text-3xl sm:text-4xl"
            splitType="words"
            effect="blur"
            textAlign="center"
            delay={70}
          />
          <p data-reveal data-reveal-delay="250" className="text-muted-foreground mt-3">
            New harvests, simple recipes and members-only offers — once a month.
          </p>
          <div className="mt-6 flex justify-center">
            <NewsletterForm />
          </div>
        </div>
      </section>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "Organization",
                name: settings.storeName,
                url: siteConfig.url,
                email: settings.supportEmail,
                ...(settings.supportPhone ? { telephone: settings.supportPhone } : {}),
              },
              {
                "@type": "WebSite",
                name: settings.storeName,
                url: siteConfig.url,
                potentialAction: {
                  "@type": "SearchAction",
                  target: `${siteConfig.url}/search?q={search_term_string}`,
                  "query-input": "required name=search_term_string",
                },
              },
            ],
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
