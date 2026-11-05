import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Package, Plus } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { FilterBar } from "@/components/admin/filter-bar";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { db } from "@/lib/db";
import { formatINR } from "@/lib/money";
import { firstValues } from "@/lib/search-params";
import { listProductsAdmin } from "@/server/services/catalog-admin";
import { requireAdminPage } from "@/server/auth/session";

export const metadata: Metadata = { title: "Products" };

const schema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional().catch(undefined),
  categoryId: z.string().max(64).optional().catch(undefined),
  stock: z.enum(["out", "low"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});

export default async function AdminProductsPage({ searchParams }: PageProps<"/admin/products">) {
  // Each page authorizes itself: layouts are not re-rendered on client-side navigation.
  await requireAdminPage();
  const raw = firstValues(await searchParams);
  const f = schema.parse(raw);
  const [result, categories] = await Promise.all([
    listProductsAdmin({ ...f, pageSize: 20 }),
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <AdminPageHeader
        title="Products"
        description="Create, edit and archive products, variants and images."
        actions={
          <Button asChild>
            <Link href="/admin/products/new">
              <Plus /> New product
            </Link>
          </Button>
        }
      />
      <Card className="gap-0 py-0">
        <FilterBar
          placeholder="Search by name, slug or SKU"
          selects={[
            {
              name: "status",
              label: "Statuses",
              options: [
                { value: "ACTIVE", label: "Active" },
                { value: "DRAFT", label: "Draft" },
                { value: "ARCHIVED", label: "Archived" },
              ],
            },
            {
              name: "categoryId",
              label: "Categories",
              options: categories.map((c) => ({ value: c.id, label: c.name })),
            },
            {
              name: "stock",
              label: "Stock levels",
              options: [{ value: "out", label: "Out of stock" }],
            },
          ]}
        />
        {result.items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Package}
              title="No products found"
              description="Adjust filters or create a new product."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Variants</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((p) => {
                const stock = p.variants
                  .filter((v) => v.isActive)
                  .reduce((s, v) => s + (v.inventory?.quantityOnHand ?? 0), 0);
                const low = p.variants.some(
                  (v) =>
                    v.isActive &&
                    (v.inventory?.quantityOnHand ?? 0) <= (v.inventory?.lowStockThreshold ?? 5),
                );
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        href={`/admin/products/${p.id}`}
                        className="flex items-center gap-3 font-medium hover:underline"
                      >
                        <span className="bg-muted relative block h-12 w-10 shrink-0 overflow-hidden rounded-md">
                          {p.images[0] && (
                            <Image
                              src={p.images[0].url}
                              alt=""
                              fill
                              sizes="40px"
                              className="object-cover"
                            />
                          )}
                        </span>
                        <span className="max-w-64 truncate">{p.name}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.category.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatINR(p.minPricePaise)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${stock === 0 ? "text-destructive" : low ? "text-brand" : ""}`}
                    >
                      {stock}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.variants.length}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <AdminPagination
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          basePath="/admin/products"
          searchParams={raw}
        />
      </Card>
    </>
  );
}
