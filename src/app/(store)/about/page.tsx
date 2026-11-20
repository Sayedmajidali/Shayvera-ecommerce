import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getSiteImages } from "@/server/modules/settings/site-images";
import { ArrowUpRight, HandHeart, Newspaper, PackageCheck, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Certifications } from "@/components/store/certifications";
import { PageIntro } from "@/components/store/page-intro";
import { StatCount } from "@/components/bits/enhanced";
import { getStoreStats } from "@/server/modules/catalog/store-stats";

export const metadata: Metadata = {
  title: "About us",
  description:
    "Shayvera Food — Rooted in Trust, Crafted with Care. Spices, masalas, dry fruits, nuts and roasted makhana made from ingredients we can trust.",
  alternates: { canonical: "/about" },
};

const promises = [
  {
    icon: Sprout,
    title: "Sourced responsibly",
    text: "Careful selection of every spice, nut and dry fruit that carries our name.",
  },
  {
    icon: PackageCheck,
    title: "Processed carefully, packed hygienically",
    text: "Every step is built around authentic flavour and responsible quality.",
  },
  {
    icon: HandHeart,
    title: "Our family promise",
    text: "What we wouldn’t feed our own family, we won’t sell to yours.",
  },
];

const mediaCoverage = [
  ["Weekly Hunt", "https://weeklyhunt.in/news/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds-and-natural-powders"],
  ["Founder Times", "https://www.foundertimes.in/article/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["Daily News Axis", "https://www.dailynewsaxis.com/business/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["Hind Mirror", "https://hindmirror.in/business/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["TDI News", "https://tdinews.in/article/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["Latest Bharat", "https://latestbharat.com/article/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["Bharat Standard", "https://bharat-standard.com/article/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["The Economic Wires", "https://www.theeconomicwires.com/article/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["One Business India", "https://onebusinessindia.com/articles/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["Medium", "https://medium.com/@gupta30kartik/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds-and-natural-powders-6e8413d35082"],
] as const;

export default async function AboutPage() {
  const [stats, site] = await Promise.all([getStoreStats(), getSiteImages()]);
  const figures = [
    { value: stats.happyKitchens, label: "Happy kitchens", suffix: "+" },
    { value: stats.ordersDelivered, label: "Orders delivered", suffix: "" },
    { value: stats.products, label: "Products in our pantry", suffix: "" },
    ...(stats.averageRating !== null && stats.reviewCount >= 3
      ? [
          {
            value: Math.round(stats.averageRating * 10) / 10,
            label: `Average rating · ${stats.reviewCount} reviews`,
            suffix: " ★",
            decimals: 1,
          },
        ]
      : []),
  ].filter((f) => f.value > 0);
  return (
    <div className="container-page pb-10">
      <PageIntro eyebrow="Shayvera Food" title="Rooted in Trust, Crafted with Care" />
      {site.aboutBanner && (
        <div className="shadow-soft relative mx-auto mb-12 aspect-[16/7] max-w-5xl overflow-hidden rounded-3xl">
          <Image
            src={site.aboutBanner.url}
            alt={site.aboutBanner.alt || "Shayvera Food"}
            fill
            priority
            sizes="(min-width: 1024px) 1024px, 100vw"
            className="object-cover"
          />
        </div>
      )}
      <div className="prose-store mx-auto max-w-2xl">
        <p className="text-foreground text-lg leading-8">
          Shayvera Food was born from a belief that food should be simple, authentic and made from
          ingredients we can trust. From spices and masalas to dry fruits, nuts and roasted makhana,
          every pack carrying our name represents a promise of careful selection, authentic flavour
          and responsible quality.
        </p>
        <h2>Our Mission</h2>
        <p>
          We exist to bring honest, everyday food back to Indian kitchens. Sourcing responsibly,
          processing carefully and packaging hygienically — every step is built around one idea:
          what we wouldn’t feed our own family, we won’t sell to yours.
        </p>
      </div>
      {figures.length > 0 && (
        <dl className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4">
          {figures.map((f) => (
            <div key={f.label} className="bg-card flex flex-col rounded-2xl border p-5 text-center">
              <dt className="text-muted-foreground order-2 mt-1 text-xs tracking-wide uppercase">
                {f.label}
              </dt>
              <dd className="heading-display text-primary text-4xl">
                <StatCount value={f.value} suffix={f.suffix} decimals={f.decimals ?? 0} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mx-auto mt-16 grid max-w-5xl gap-6 md:grid-cols-3">
        {promises.map(({ icon: Icon, title, text }) => (
          <div key={title} className="bg-card rounded-2xl border p-7">
            <div className="bg-brand-soft text-brand flex size-11 items-center justify-center rounded-full">
              <Icon className="size-5" aria-hidden />
            </div>
            <h3 className="heading-display mt-5 text-2xl">{title}</h3>
            <p className="text-muted-foreground mt-3 text-sm leading-6">{text}</p>
          </div>
        ))}
      </div>

      <section className="mx-auto mt-16 max-w-5xl" aria-labelledby="media-coverage-heading">
        <div className="mb-7 text-center">
          <p className="text-brand text-xs font-semibold tracking-[0.22em] uppercase">In the news</p>
          <h2 id="media-coverage-heading" className="heading-display mt-2 text-3xl sm:text-4xl">
            Media coverage
          </h2>
          <p class="text-muted-foreground mx-auto mt-3 max-w-2xl text-sm leading-6">
            Shayvera Food Private Limited has been featured across 10 digital media platforms,
            highlighting our expanding range of spices, makhana, seeds and natural powders.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {mediaCoverage.map(([publication, href], index) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-card hover:border-primary/30 flex min-h-32 flex-col justify-between rounded-2xl border p-5 transition-colors"
              aria-label={`Read Shayvera coverage from ${publication} (opens in a new tab)`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="bg-brand-soft text-brand flex size-9 items-center justify-center rounded-full">
                  <Newspaper className="size-4" aria-hidden />
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <div className="mt-4 flex items-end justify-between gap-2">
                <p className="text-sm font-semibold">{publication}</p>
                <ArrowUpRight className="text-primary size-4 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
              </div>
            </a>
          ))}
        </div>
      </section>

      <Certifications bare className="mt-8 pb-0" />
      <div className="mt-12 text-center">
        <Button asChild size="lg">
          <Link href="/shop">Shop our pantry</Link>
        </Button>
      </div>
    </div>
  );
}
