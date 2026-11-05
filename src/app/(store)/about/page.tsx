import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageIntro } from "@/components/store/page-intro";

export const metadata: Metadata = { title: "Our story", alternates: { canonical: "/about" } };

const values = [
  {
    title: "Made by hand",
    text: "We work directly with more than 40 small studios and artisan clusters across India.",
  },
  {
    title: "Built to last",
    text: "We choose materials that age well — stoneware, cotton, brass, wood — over trends that don’t.",
  },
  {
    title: "Fair by design",
    text: "Makers set their own prices. We publish our margins to them and pay within 15 days.",
  },
];

export default function AboutPage() {
  return (
    <div className="container-page pb-10">
      <PageIntro eyebrow="Our story" title="Objects with a story, for homes with character">
        <p>
          Shayvera began in 2021 at a kitchen table in Bengaluru, with a box of mugs from a potter
          in Khurja.
        </p>
      </PageIntro>
      <div className="prose-store mx-auto max-w-2xl">
        <p>
          We believed everyday objects deserved the same care as the special ones. The mug you reach
          for every morning, the towel you wrap yourself in, the notebook that holds your plans —
          these are the things that shape our days.
        </p>
        <p>
          Today we curate a growing collection of home, kitchen, wellness and lifestyle goods, each
          chosen for its craft, its materials and its usefulness. Every product is quality-checked
          in our studio before it is packed in recyclable, plastic-free packaging.
        </p>
      </div>
      <div className="mx-auto mt-16 grid max-w-5xl gap-6 md:grid-cols-3">
        {values.map((v) => (
          <div key={v.title} className="bg-card rounded-2xl border p-7">
            <h2 className="heading-display text-2xl">{v.title}</h2>
            <p className="text-muted-foreground mt-3 text-sm leading-6">{v.text}</p>
          </div>
        ))}
      </div>
      <div className="mt-16 text-center">
        <Button asChild size="lg">
          <Link href="/shop">Explore the collection</Link>
        </Button>
      </div>
    </div>
  );
}
