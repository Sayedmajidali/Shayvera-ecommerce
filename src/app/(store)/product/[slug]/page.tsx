import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RotateCcw, ShieldCheck, Truck } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { ProductGrid } from "@/components/store/product-card";
import { ProductGallery } from "@/components/store/product-gallery";
import { ProductPurchase } from "@/components/store/product-purchase";
import { RatingStars } from "@/components/store/rating-stars";
import { formatINR } from "@/lib/money";
import { siteConfig } from "@/lib/site";
import { getProductBySlug, getRelatedProducts } from "@/server/queries/catalog";
import { getStoreSettings } from "@/server/queries/settings";

export async function generateMetadata({
  params,
}: PageProps<"/product/[slug]">): Promise<Metadata> {
  const product = await getProductBySlug((await params).slug);
  if (!product) return { title: "Product not found" };
  const description =
    product.seoDescription ?? product.shortDescription ?? product.description.slice(0, 155);
  return {
    title: product.seoTitle ?? product.name,
    description,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      type: "website",
      title: product.name,
      description,
      images: product.images.slice(0, 1).map((i) => ({ url: i.url, alt: i.alt })),
    },
  };
}

export default async function ProductPage({ params }: PageProps<"/product/[slug]">) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const [related, settings] = await Promise.all([
    getRelatedProducts(product.id, product.category.id),
    getStoreSettings(),
  ]);

  const prices = product.variants.map((v) => v.pricePaise);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.shortDescription ?? product.description,
    image: product.images.map((i) => new URL(i.url, siteConfig.url).toString()),
    sku: product.variants[0]?.sku,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    category: product.category.name,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "INR",
      lowPrice: (Math.min(...prices) / 100).toFixed(2),
      highPrice: (Math.max(...prices) / 100).toFixed(2),
      offerCount: product.variants.length,
      availability: product.variants.some((v) => v.stock > 0)
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url: new URL(`/product/${product.slug}`, siteConfig.url).toString(),
    },
    ...(product.ratingCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: product.ratingAverage.toFixed(1),
            reviewCount: product.ratingCount,
          },
        }
      : {}),
  };

  return (
    <div className="container-page py-10">
      <Breadcrumbs
        items={[
          { label: "Shop", href: "/shop" },
          { label: product.category.name, href: `/category/${product.category.slug}` },
          { label: product.name },
        ]}
      />
      <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-16">
        <ProductGallery
          images={product.images.map((i) => ({ url: i.url, alt: i.alt }))}
          name={product.name}
        />
        <div className="lg:py-4">
          {product.brand && (
            <p className="text-brand text-xs font-medium tracking-[0.2em] uppercase">
              {product.brand}
            </p>
          )}
          <h1 className="heading-display mt-2 text-4xl leading-tight sm:text-5xl">
            {product.name}
          </h1>
          {product.ratingCount > 0 && (
            <a href="#reviews" className="mt-3 inline-flex">
              <RatingStars rating={product.ratingAverage} count={product.ratingCount} />
            </a>
          )}
          {product.shortDescription && (
            <p className="text-muted-foreground mt-4 text-lg">{product.shortDescription}</p>
          )}
          <div className="mt-8">
            <ProductPurchase variants={product.variants} />
          </div>
          <ul className="bg-card mt-8 grid gap-3 rounded-2xl border p-5 text-sm">
            <li className="flex items-center gap-3">
              <Truck className="text-brand size-4" aria-hidden />
              {settings.freeShippingThresholdPaise !== null
                ? `Free shipping above ${formatINR(settings.freeShippingThresholdPaise)}; otherwise ${formatINR(settings.shippingFlatPaise)}`
                : `Shipping ${formatINR(settings.shippingFlatPaise)} across India`}
            </li>
            {settings.codEnabled && (
              <li className="flex items-center gap-3">
                <ShieldCheck className="text-brand size-4" aria-hidden /> Cash on Delivery available
                on eligible orders
              </li>
            )}
            <li className="flex items-center gap-3">
              <RotateCcw className="text-brand size-4" aria-hidden /> 7-day easy returns
            </li>
          </ul>
          <Accordion type="multiple" defaultValue={["description"]} className="mt-8">
            <AccordionItem value="description">
              <AccordionTrigger>Description</AccordionTrigger>
              <AccordionContent className="text-muted-foreground space-y-3 leading-7 whitespace-pre-line">
                {product.description}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="shipping">
              <AccordionTrigger>Shipping & returns</AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-7">
                Orders are dispatched within 1–2 business days and delivered in 3–7 business days
                across India. Unused items can be returned within 7 days of delivery. See our
                shipping & returns policy for details.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>

      <section id="reviews" className="mt-24 scroll-mt-24">
        <h2 className="heading-display text-3xl">Customer reviews</h2>
        {product.reviews.length === 0 ? (
          <p className="text-muted-foreground mt-4">No reviews yet.</p>
        ) : (
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {product.reviews.map((r) => (
              <article key={r.id} className="bg-card rounded-2xl border p-6">
                <div className="flex items-center justify-between gap-2">
                  <RatingStars rating={r.rating} />
                  <time
                    className="text-muted-foreground text-xs"
                    dateTime={r.createdAt.toISOString()}
                  >
                    {r.createdAt.toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </time>
                </div>
                {r.title && <h3 className="mt-3 font-medium">{r.title}</h3>}
                <p className="text-muted-foreground mt-2 text-sm leading-6">{r.body}</p>
                <p className="text-muted-foreground mt-4 text-xs">
                  {r.user.name}
                  {r.verifiedPurchase && (
                    <span className="text-success ml-2">· Verified purchase</span>
                  )}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      {related.length > 0 && (
        <section className="mt-24">
          <h2 className="heading-display mb-8 text-3xl">You may also like</h2>
          <ProductGrid products={related} />
        </section>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
    </div>
  );
}
