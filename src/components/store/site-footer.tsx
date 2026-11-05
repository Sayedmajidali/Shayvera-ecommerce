import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import { Logo } from "@/components/store/logo";
import { NewsletterForm } from "@/components/store/newsletter-form";
import { stateName } from "@/lib/india";
import { getNavCategories } from "@/server/queries/catalog";
import { getStoreSettings } from "@/server/queries/settings";

export async function SiteFooter() {
  const [categories, settings] = await Promise.all([getNavCategories(), getStoreSettings()]);
  return (
    <footer className="bg-card mt-24 border-t">
      <div className="container-page grid gap-12 py-16 md:grid-cols-2 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Logo />
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
          <h2 className="text-sm font-semibold">Shop</h2>
          <ul className="text-muted-foreground mt-4 space-y-2.5 text-sm">
            <li>
              <Link href="/shop" className="hover:text-foreground">
                All products
              </Link>
            </li>
            {categories.slice(0, 6).map((c) => (
              <li key={c.slug}>
                <Link href={`/category/${c.slug}`} className="hover:text-foreground">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold">Help</h2>
          <ul className="text-muted-foreground mt-4 space-y-2.5 text-sm">
            <li>
              <Link href="/account/orders" className="hover:text-foreground">
                Track an order
              </Link>
            </li>
            <li>
              <Link href="/shipping-returns" className="hover:text-foreground">
                Shipping & returns
              </Link>
            </li>
            <li>
              <Link href="/contact" className="hover:text-foreground">
                Contact us
              </Link>
            </li>
            <li>
              <Link href="/about" className="hover:text-foreground">
                Our story
              </Link>
            </li>
          </ul>
        </div>
        <div className="md:col-span-2 lg:col-span-4">
          <h2 className="text-sm font-semibold">The Shayvera kitchen letter</h2>
          <p className="text-muted-foreground mt-4 mb-4 text-sm">
            New harvests, recipes and members-only offers. Once a month, never more.
          </p>
          <NewsletterForm />
        </div>
      </div>
      <div className="border-t">
        <div className="container-page text-muted-foreground flex flex-col gap-3 py-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {settings.legalName ?? settings.storeName}. All prices in
            INR.
            {settings.fssaiLicense ? ` FSSAI Lic. No. ${settings.fssaiLicense}.` : ""}
          </p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/shipping-returns" className="hover:text-foreground">
              Shipping & returns
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
