import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Newspaper } from "lucide-react";
import { PageIntro } from "@/components/store/page-inty";

export const metadata: Metadata = {
  title: "Media Coverage",
  description:
    "Media coverage and published articles featuring Shayvera Food, including its spices, makhana, seeds and natural powders.",
  alternates: { canonical: "/press" },
};

const coverage = [
  ["Weekly Hunt", "Shayvera Food Private Limited Expands Its Range of Spices, Makhana, Seeds and Natural Powders", "https://weeklyhunt.in/news/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds-and-natural-powders"],
  ["Founder Times", "Shayvera Food Private Limited Expands Its Range of Spices, Makhana, Seeds", "https://www.foundertimes.in/article/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["Daily News Axis", "Shayvera Food Private Limited Expands Its Range of Spices, Makhana, Seeds", "https://www.dailynewsaxis.com/business/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["Hind Mirror", "Shayvera Food Private Limited Expands Its Range of Spices, Makhana, Seeds", "https://hindmirror.in/business/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["TDI News", "Shayvera Food Private Limited Expands Its Range of Spices, Makhana, Seeds", "https://tdinews.in/article/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["Latest Bharat", "Shayvera Food Private Limited Expands Its Range of Spices, Makhana, Seeds", "https://latestbharat.com/article/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["Bharat Standard", "Shayvera Food Private Limited Expands Its Range of Spices, Makhana, Seeds", "https://bharat-standard.com/article/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["The Economic Wires", "Shayvera Food Private Limited Expands Its Range of Spices, Makhana, Seeds", "https://www.theeconomicwires.com/article/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["One Business India", "Shayvera Food Private Limited Expands Its Range of Spices, Makhana, Seeds", "https://onebusinessindia.com/articles/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds"],
  ["Medium", "Shayvera Food Private Limited Expands Its Range of Spices, Makhana, Seeds and Natural Powders", "https://medium.com/@gupta30kartik/shayvera-food-private-limited-expands-its-range-of-spices-makhana-seeds-and-natural-powders-6e8413d35082"],
] as const;

export default function PressPage() {
  return (
    <div className="container-page pb-16">
      <PageIntro eyebrow="Media coverage" title="Shayvera in the news" />
      <div className="prose-store mx-auto max-w-3xl text-center">
        <p className="text-lg leading-8">
          Shayvera Food Private Limited has been featured across 10 digital media platforms,
          highlighting our expanding range of spices, makhana, seeds and natural powders.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-5xl gap-5 md:grid-cols-2">
        {coverage.map(([publication, headline, href], index) => (
          <article
            key={href}
            className="lift bg-card relative flex min-h-52 flex-col rounded-3xl border p-6 sm:p-7"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="bg-brand-soft text-brand flex size-11 items-center justify-center rounded-full">
                <Newspaper className="size-5" aria-hidden="true" />
              </div>
              <span className="text-muted-foreground text-xs font-semibold tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <p className="text-brand mt-5 text-xs font-semibold tracking-[0.18em] uppercase">
              {publication}
            </p>
            <h2 className="heading-display mt-2 flex-1 text-xl leading-snug">{headline}</h2>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary mt-5 inline-flex items-center gap-1.5 text-sm font-semibold"
            >
              Read article
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
          </article>
        ))}
      </div>

      <div className="mt-12 text-center">
        <Link href="/" className="text-primary text-sm font-semibold underline underline-offset-4">
          Return to the Shayvera store
        </Link>
      </div>
    </div>
  );
}
