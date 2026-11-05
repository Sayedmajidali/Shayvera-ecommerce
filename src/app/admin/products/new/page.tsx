import type { Metadata } from "next";
import { ProductForm } from "@/components/admin/product-form";
import { AdminPageHeader } from "@/components/admin/page-header";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/server/auth/session";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  // Each page authorizes itself: layouts are not re-rendered on client-side navigation.
  await requireAdminPage();
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
          ingredients: "",
          shelfLife: "",
          storageInfo: "",
          countryOfOrigin: "India",
          isVegetarian: true,
          seoTitle: "",
          seoDescription: "",
        }}
      />
    </>
  );
}
