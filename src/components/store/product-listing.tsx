import Link from "next/link";
import { PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import {
  ActiveFilters,
  FilterSidebar,
  MobileFilters,
  SortSelect,
} from "@/components/store/listing-controls";
import { Pagination } from "@/components/store/pagination";
import { ProductGrid } from "@/components/store/product-card";
import {
  SORT_OPTIONS,
  getNavCategories,
  listProducts,
  type ProductListParams,
} from "@/server/modules/catalog/queries";

export async function ProductListing({
  params,
  rawSearchParams,
  basePath,
  showCategoryFilter = true,
}: {
  params: ProductListParams;
  rawSearchParams: Record<string, string | undefined>;
  basePath: string;
  showCategoryFilter?: boolean;
}) {
  const [result, categories] = await Promise.all([listProducts(params), getNavCategories()]);
  const cats = categories.map((c) => ({ name: c.name, slug: c.slug }));

  return (
    <div className="flex gap-10">
      <FilterSidebar categories={cats} showCategories={showCategoryFilter} />
      <div className="min-w-0 flex-1">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <MobileFilters categories={cats} showCategories={showCategoryFilter} />
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {result.total} {result.total === 1 ? "product" : "products"}
            </p>
          </div>
          <SortSelect options={SORT_OPTIONS} />
        </div>
        <div className="mb-6">
          <ActiveFilters categories={cats} />
        </div>
        {result.items.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title="No products match your filters"
            description="Try removing a filter or searching for something else."
            action={
              <Button asChild variant="outline">
                <Link href={basePath}>Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <>
            <ProductGrid products={result.items} priorityCount={4} heading="Products" />
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              basePath={basePath}
              searchParams={rawSearchParams}
            />
          </>
        )}
      </div>
    </div>
  );
}
