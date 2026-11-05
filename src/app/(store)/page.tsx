import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Leaf, Quote, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewsletterForm } from "@/components/store/newsletter-form";
import { ProductGrid } from "@/components/store/product-card";
import { RatingStars } from "@/components/store/rating-stars";
import { formatINR } from "@/lib/money";
import { getHomeData } from "@/server/queries/catalog";
import { getStoreSettings } from "@/server/queries/settings";
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
    <div className="mb-8 flex items-end justify-between gap-4">
      <div>
        <p className="text-brand text-xs font-medium tracking-[0.2em] uppercase">{eyebrow}</p>
        <h2 className="heading-display mt-2 text-3xl sm:text-4xl">{title}</h2>
      </div>
      {href && (
        <Link href={href} className="group hidden items-center gap-1 text-sm font-medium sm:flex">
          {cta ?? "View all"}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}

export default async function HomePage() {
  const [{ categories, featured, bestsellers, newArrivals, testimonials }, settings] =
    await Promise.all([getHomeData(), getStoreSettings()]);
  const heroImages = featured.flatMap((p) => p.images.slice(0, 1)).slice(0, 2);
  const featuredCategories = categories.filter((c) => c.isFeatured).slice(0, 4);

  return (
    <>
      {/* Hero */}
      <section className="container-page pt-8 pb-16 sm:pt-12 lg:pb-24">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="animate-fade-up">
            <p className="text-brand text-xs font-medium tracking-[0.25em] uppercase">
              Spices · Dry fruits · Nuts · Makhana
            </p>
            <h1 className="heading-display mt-5 text-5xl leading-[1.05] sm:text-6xl xl:text-7xl">
              Rooted in trust, <em className="text-brand not-italic">crafted with care.</em>
            </h1>
            <p className="text-muted-foreground mt-6 max-w-lg text-lg leading-8">
              Simple, authentic food made from ingredients we can trust — carefully selected,
              processed with care and hygienically packed for Indian kitchens.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/shop">
                  Shop the pantry <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/about">Our promise</Link>
              </Button>
            </div>
            <p className="text-muted-foreground mt-10 max-w-md border-t pt-6 text-sm italic">
              “What we wouldn’t feed our own family, we won’t sell to yours.”
            </p>
          </div>
          <div className="relative grid grid-cols-5 gap-4">
            {heroImages[0] && (
              <div className="shadow-lift relative col-span-3 aspect-[4/5] overflow-hidden rounded-2xl">
                <Image
                  src={heroImages[0].url}
                  alt={heroImages[0].alt}
                  fill
                  priority
                  sizes="(min-width: 1024px) 30vw, 60vw"
                  className="object-cover"
                />
              </div>
            )}
            {heroImages[1] && (
              <div className="shadow-lift relative col-span-2 mt-16 aspect-[4/5] overflow-hidden rounded-2xl">
                <Image
                  src={heroImages[1].url}
                  alt={heroImages[1].alt}
                  fill
                  priority
                  sizes="(min-width: 1024px) 20vw, 40vw"
                  className="object-cover"
                />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="bg-card border-y">
        <div className="container-page grid grid-cols-2 gap-6 py-8 lg:grid-cols-4">
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
            <div key={title} className="flex items-start gap-3">
              <div className="bg-brand-soft text-brand flex size-10 shrink-0 items-center justify-center rounded-full">
                <Icon className="size-5" aria-hidden />
              </div>
              <div>
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-muted-foreground text-sm">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Featured categories */}
      {featuredCategories.length > 0 && (
        <section className="container-page py-20">
          <SectionHeading
            eyebrow="Explore"
            title="Shop by category"
            href="/shop"
            cta="All products"
          />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {featuredCategories.map((c) => (
              <Link
                key={c.slug}
                href={`/category/${c.slug}`}
                className="group bg-muted relative aspect-[4/5] overflow-hidden rounded-2xl"
              >
                {c.imageUrl && (
                  <Image
                    src={c.imageUrl}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 24vw, 48vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                  <h3 className="heading-display text-2xl">{c.name}</h3>
                  <p className="mt-1 text-sm text-white/80">{c._count.products} products</p>
                </div>
              </Link>
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
        <div className="bg-primary text-primary-foreground relative overflow-hidden rounded-3xl px-6 py-14 sm:px-12 lg:px-16">
          <div
            className="bg-brand/40 absolute -top-24 -right-24 size-80 rounded-full blur-3xl"
            aria-hidden
          />
          <div className="relative grid gap-8 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs font-medium tracking-[0.25em] text-white/70 uppercase">
                Welcome offer
              </p>
              <h2 className="heading-display mt-3 text-4xl sm:text-5xl">
                10% off your first order
              </h2>
              <p className="mt-4 max-w-md text-white/75">
                Use code{" "}
                <span className="rounded-md bg-white/15 px-2 py-0.5 font-mono font-semibold text-white">
                  WELCOME10
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

      {/* Testimonials */}
      {testimonials.length > 0 && (
        <section className="bg-card py-20">
          <div className="container-page">
            <SectionHeading eyebrow="Kind words" title="From our customers" />
            <div className="grid gap-6 md:grid-cols-3">
              {testimonials.map((t) => (
                <figure key={t.id} className="bg-background flex flex-col rounded-2xl border p-7">
                  <Quote className="text-brand size-6" aria-hidden />
                  <RatingStars rating={t.rating} className="mt-4" />
                  <blockquote className="mt-3 flex-1 text-[15px] leading-7">
                    {t.title && <p className="font-medium">{t.title}</p>}
                    <p className="text-muted-foreground">{t.body}</p>
                  </blockquote>
                  <figcaption className="mt-6 border-t pt-4 text-sm">
                    <span className="font-medium">{t.user.name}</span>
                    <span className="text-muted-foreground"> on </span>
                    <Link
                      href={`/product/${t.product.slug}`}
                      className="underline-offset-4 hover:underline"
                    >
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
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="heading-display text-3xl sm:text-4xl">
            Recipes & offers from our kitchen
          </h2>
          <p className="text-muted-foreground mt-3">
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
