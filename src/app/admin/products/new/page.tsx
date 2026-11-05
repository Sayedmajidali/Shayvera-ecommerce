import type { Metadata } from "next";
import { ProductForm } from "@/components/admin/product-form";
import { AdminPageHeader } from "@/components/admin/page-header";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const categories = await db.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return (
    <>
      <AdminPageHeader
        title="New product"
        description="Create the product and its variants. Images are added on the next screen."
      />
      <ProductForm
        mode="create"
        categories={categories}
        initial={{
          name: "",
          slug: "",
          shortDescription: "",
          description: "",
          brand: "",
          categoryId: categories[0]?.id ?? "",
          status: "DRAFT",
          isFeatured: false,
          taxRateBps: "",
          hsnCode: "",
          seoTitle: "",
          seoDescription: "",
        }}
      />
    </>
  );
}
