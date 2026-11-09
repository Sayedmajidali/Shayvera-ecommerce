import Image from "next/image";
import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import { Logo } from "@/components/store/logo";
import { NewsletterForm } from "@/components/store/newsletter-form";
import { stateName } from "@/lib/india";
import { getNavCategories } from "@/server/modules/catalog/queries";
import { getStoreSettings } from "@/server/modules/settings/queries";

export async function SiteFooter() {
  const [categories, settings] = await Promise.all([getNavCategories(), getStoreSettings()]);
  return (
    <footer className="bg-deep-aura text-deep-foreground relative mt-24 overflow-hidden [--border:oklch(1_0_0/0.12)] [--muted-foreground:oklch(0.86_0.03_130)]">
      <div className="from-leaf via-brand to-primary h-1 bg-gradient-to-r" aria-hidden />
      <Image
        src="/brand/mark.svg"
        alt=""
        width={440}
        height={296}
        unoptimized
        className="pointer-events-none absolute -right-24 bottom-10 hidden w-[30rem] opacity-[0.06] brightness-0 invert select-none lg:block"
      />
      <div className="container-page relative grid gap-12 py-16 md:grid-cols-2 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Logo tone="light" size="lg" />
          <p className="text-muted-foreground mt-4 max-w-xs text-sm leading-6">
            Rooted in trust, crafted with care. Spices, masalas, dry fruits, nuts and roasted
            makhana — carefully selected and hygienically packed.
          </p>
          <ul className="text-muted-foreground mt-6 space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <Mail className="size-4" aria-hidden /> {settings.supportEmail}
            </li>
            {settings.supportPhone && (
              <li className="flex items-center gap-2">
                <Phone className="size-4" aria-hidden /> {settings.supportPhone}
              </li>
            )}
            {settings.city && (
              <li className="flex items-center gap-2">
                <MapPin className="size-4" aria-hidden /> {settings.city},{" "}
                {stateName(settings.stateCode)}
              </li>
            )}
          </ul>
        </div>
        <div className="lg:col-span-2">
          <h2 className="text-leaf text-xs font-semibold tracking-[0.2em] uppercase">Shop</h2>
          <ul className="text-muted-foreground mt-4 space-y-2.5 text-sm">
            <li>
              <Link href="/shop" className="link-draw hover:text-white">
                All products
              </Link>
            </li>
            {categories.slice(0, 6).map((c) => (
              <li key={c.slug}>
                <Link href={`/category/${c.slug}`} className="link-draw hover:text-white">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:col-span-2">
          <h2 className="text-leaf text-xs font-semibold tracking-[0.2em] uppercase">Help</h2>
          <ul className="text-muted-foreground mt-4 space-y-2.5 text-sm">
            <li>
              <Link href="/track" className="link-draw hover:text-white">
                Track an order
              </Link>
            </li>
            <li>
              <Link href="/shipping-returns" className="link-draw hover:text-white">
                Shipping & returns
              </Link>
            </li>
            <li>
              <Link href="/contact" className="link-draw hover:text-white">
                Contact us
              </Link>
            </li>
            <li>
              <Link href="/about" className="link-draw hover:text-white">
                Our story
              </Link>
            </li>
          </ul>
        </div>
        <div className="md:col-span-2 lg:col-span-4">
          <h2 className="text-leaf text-xs font-semibold tracking-[0.2em] uppercase">
            The Shayvera kitchen letter
          </h2>
          <p className="text-muted-foreground mt-4 mb-4 text-sm">
            New harvests, recipes and members-only offers. Once a month, never more.
          </p>
          <NewsletterForm tone="dark" />
        </div>
      </div>
      <div className="relative border-t">
        <div className="container-page text-muted-foreground flex flex-col gap-3 py-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {settings.legalName ?? settings.storeName}. All prices in
            INR.
            {settings.fssaiLicense ? ` FSSAI Lic. No. ${settings.fssaiLicense}.` : ""}
          </p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/privacy" className="link-draw hover:text-white">
              Privacy
            </Link>
            <Link href="/terms" className="link-draw hover:text-white">
              Terms
            </Link>
            <Link href="/shipping-returns" className="link-draw hover:text-white">
              Shipping & returns
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
