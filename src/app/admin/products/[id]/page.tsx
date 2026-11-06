import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteProductButton } from "@/components/admin/delete-product-button";
import { ImagesManager } from "@/components/admin/images-manager";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ProductForm } from "@/components/admin/product-form";
import { StatusBadge } from "@/components/admin/status-badge";
import { VariantsEditor } from "@/components/admin/variants-editor";
import { db } from "@/server/platform/db";
import { requireAdminPage } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: PageProps<"/admin/products/[id]">) {
  // Each page authorizes itself: layouts are not re-rendered on client-side navigation.
  await requireAdminPage();
  const { id } = await params;
  const [product, categories] = await Promise.all([
    db.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { sortOrder: "asc" } },
        variants: { orderBy: { sortOrder: "asc" }, include: { inventory: true } },
        _count: { select: { orderItems: true } },
      },
    }),
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!product) notFound();

  return (
    <>
      <AdminPageHeader
        title={product.name}
        description={`${product._count.orderItems} order line(s) · updated ${product.updatedAt.toLocaleString("en-IN")}`}
        actions={
          <>
            <StatusBadge status={product.status} className="self-center" />
            {product.status === "ACTIVE" && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/product/${product.slug}`} target="_blank">
                  <ExternalLink /> View in store
                </Link>
              </Button>
            )}
            <DeleteProductButton productId={product.id} hasOrders={product._count.orderItems > 0} />
          </>
        }
      />
      <div className="grid gap-6">
        <ImagesManager productId={product.id} productName={product.name} images={product.images} />
        <VariantsEditor
          productId={product.id}
          variants={product.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            name: v.name,
            options: (v.options ?? {}) as Record<string, string>,
            pricePaise: v.pricePaise,
            compareAtPricePaise: v.compareAtPricePaise,
            isActive: v.isActive,
            stock: v.inventory?.quantityOnHand ?? 0,
            lowStockThreshold: v.inventory?.lowStockThreshold ?? 5,
          }))}
        />
        <ProductForm
          mode="edit"
          productId={product.id}
          categories={categories}
          initial={{
            name: product.name,
            slug: product.slug,
            shortDescription: product.shortDescription ?? "",
            description: product.description,
            brand: product.brand ?? "",
            categoryId: product.categoryId,
            status: product.status,
            isFeatured: product.isFeatured,
            taxRateBps: product.taxRateBps === null ? "" : String(product.taxRateBps),
            hsnCode: product.hsnCode ?? "",
            ingredients: product.ingredients ?? "",
            shelfLife: product.shelfLife ?? "",
            storageInfo: product.storageInfo ?? "",
            countryOfOrigin: product.countryOfOrigin,
            isVegetarian: product.isVegetarian,
            seoTitle: product.seoTitle ?? "",
            seoDescription: product.seoDescription ?? "",
          }}
        />
      </div>
    </>
  );
}
