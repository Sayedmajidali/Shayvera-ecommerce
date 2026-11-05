import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { ProductListing } from "@/components/store/product-listing";
import { firstValues } from "@/lib/search-params";
import { getCategoryBySlug, productListParamsSchema } from "@/server/queries/catalog";

export async function generateMetadata({
  params,
}: PageProps<"/category/[slug]">): Promise<Metadata> {
  const category = await getCategoryBySlug((await params).slug);
  if (!category) return { title: "Category not found" };
  return {
    title: category.seoTitle ?? category.name,
    description: category.seoDescription ?? category.description ?? undefined,
    alternates: { canonical: `/category/${category.slug}` },
    openGraph: { images: category.imageUrl ? [category.imageUrl] : undefined },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: PageProps<"/category/[slug]">) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();
  const raw = firstValues(await searchParams);
  const listParams = productListParamsSchema.parse({ ...raw, category: slug });

  return (
    <div className="container-page py-10">
      <Breadcrumbs items={[{ label: "Shop", href: "/shop" }, { label: category.name }]} />
      <header className="bg-muted relative mt-6 mb-10 overflow-hidden rounded-3xl">
        {category.imageUrl && (
          <Image
            src={category.imageUrl}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-90"
          />
        )}
        <div className="from-background/95 via-background/75 relative bg-gradient-to-r to-transparent px-6 py-14 sm:px-10 sm:py-20">
          <h1 className="heading-display text-4xl sm:text-5xl">{category.name}</h1>
          {category.description && (
            <p className="text-muted-foreground mt-3 max-w-lg">{category.description}</p>
          )}
        </div>
      </header>
      <ProductListing
        params={listParams}
        rawSearchParams={raw}
        basePath={`/category/${slug}`}
        showCategoryFilter={false}
      />
    </div>
  );
}
