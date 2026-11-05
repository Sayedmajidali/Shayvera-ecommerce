import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { ProductListing } from "@/components/store/product-listing";
import { firstValues } from "@/lib/search-params";
import { productListParamsSchema } from "@/server/queries/catalog";

export async function generateMetadata({ searchParams }: PageProps<"/search">): Promise<Metadata> {
  const q = firstValues(await searchParams).q;
  return { title: q ? `Search: ${q}` : "Search", robots: { index: false, follow: true } };
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const raw = firstValues(await searchParams);
  const params = productListParamsSchema.parse(raw);
  return (
    <div className="container-page py-10">
      <Breadcrumbs items={[{ label: "Search" }]} />
      <header className="mt-6 mb-10">
        <p className="text-muted-foreground text-sm">Search results for</p>
        <h1 className="heading-display mt-1 text-4xl sm:text-5xl">
          {params.q ? `“${params.q}”` : "All products"}
        </h1>
      </header>
      <ProductListing params={params} rawSearchParams={raw} basePath="/search" />
    </div>
  );
}
