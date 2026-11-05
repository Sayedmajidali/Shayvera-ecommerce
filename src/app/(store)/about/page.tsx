import type { Metadata } from "next";
import Link from "next/link";
import { HandHeart, PackageCheck, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageIntro } from "@/components/store/page-intro";

export const metadata: Metadata = {
  title: "About us",
  description:
    "Shayvera Foods — Rooted in Trust, Crafted with Care. Spices, masalas, dry fruits, nuts and roasted makhana made from ingredients we can trust.",
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

export default function AboutPage() {
  return (
    <div className="container-page pb-10">
      <PageIntro eyebrow="Shayvera Foods" title="Rooted in Trust, Crafted with Care" />
      <div className="prose-store mx-auto max-w-2xl">
        <p className="text-foreground text-lg leading-8">
          Shayvera Foods was born from a belief that food should be simple, authentic and made from
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
      <div className="mt-16 text-center">
        <Button asChild size="lg">
          <Link href="/shop">Shop our pantry</Link>
        </Button>
      </div>
    </div>
  );
}
