import type { Metadata } from "next";
import { CategoryManager } from "@/components/admin/category-manager";
import { AdminPageHeader } from "@/components/admin/page-header";
import { listCategoriesAdmin } from "@/server/services/catalog-admin";
import { requireAdminPage } from "@/server/auth/session";

export const metadata: Metadata = { title: "Categories" };

export default async function AdminCategoriesPage() {
  // Each page authorizes itself: layouts are not re-rendered on client-side navigation.
  await requireAdminPage();
  const categories = await listCategoriesAdmin();
  return (
    <>
      <AdminPageHeader
        title="Categories"
        description="Organise the catalog and control navigation order."
      />
      <CategoryManager
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          description: c.description,
          sortOrder: c.sortOrder,
          isActive: c.isActive,
          isFeatured: c.isFeatured,
          seoTitle: c.seoTitle,
          seoDescription: c.seoDescription,
          productCount: c._count.products,
        }))}
      />
    </>
  );
}
