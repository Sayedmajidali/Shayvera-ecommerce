import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { ProductListing } from "@/components/store/product-listing";
import { firstValues } from "@/lib/search-params";
import { productListParamsSchema } from "@/server/modules/catalog/queries";

export const metadata: Metadata = {
  title: "Shop all products",
  description:
    "Shop Shayvera Food: whole spices, masalas, dry fruits, nuts and roasted makhana, delivered across India.",
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
          Whole spices and masalas, dry fruits, nuts and roasted makhana — carefully selected and
          hygienically packed.
        </p>
      </header>
      <ProductListing params={params} rawSearchParams={raw} basePath="/shop" />
    </div>
  );
}
