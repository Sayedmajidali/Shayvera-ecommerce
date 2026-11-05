import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { ProductListing } from "@/components/store/product-listing";
import { firstValues } from "@/lib/search-params";
import { productListParamsSchema } from "@/server/queries/catalog";

export const metadata: Metadata = {
  title: "Shop all products",
  description:
    "Browse the full Shayvera collection of home, kitchen, wellness and lifestyle goods.",
  alternates: { canonical: "/shop" },
};

export default async function ShopPage({ searchParams }: PageProps<"/shop">) {
  const raw = firstValues(await searchParams);
  const params = productListParamsSchema.parse(raw);
  return (
    <div className="container-page py-10">
      <Breadcrumbs items={[{ label: "Shop" }]} />
      <header className="mt-6 mb-10">
        <h1 className="heading-display text-4xl sm:text-5xl">Shop all</h1>
        <p className="text-muted-foreground mt-3 max-w-2xl">
          Everything we make and curate — from stoneware and textiles to small rituals for the
          everyday.
        </p>
      </header>
      <ProductListing params={params} rawSearchParams={raw} basePath="/shop" />
    </div>
  );
}
