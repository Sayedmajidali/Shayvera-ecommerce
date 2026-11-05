import type { Metadata } from "next";
import Link from "next/link";
import type { InventoryReason, Prisma } from "@prisma/client";
import { z } from "zod";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
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
import { StockAdjustButton } from "@/components/admin/stock-adjust-button";
import { db } from "@/lib/db";
import { firstValues } from "@/lib/search-params";

export const metadata: Metadata = { title: "Inventory" };

const REASONS = [
  "INITIAL",
  "ADJUSTMENT",
  "RESTOCK",
  "DAMAGE",
  "ORDER_PLACED",
  "ORDER_CANCELLED",
  "PAYMENT_EXPIRED",
  "RETURN",
  "CORRECTION",
] as const;
const schema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  level: z.enum(["low", "out"]).optional().catch(undefined),
  reason: z.enum(REASONS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});
const PAGE = 25;

export default async function InventoryPage({ searchParams }: PageProps<"/admin/inventory">) {
  const raw = firstValues(await searchParams);
  const f = schema.parse(raw);
  const textFilter: Prisma.ProductVariantWhereInput = f.q
    ? {
        OR: [
          { sku: { contains: f.q, mode: "insensitive" } },
          { name: { contains: f.q, mode: "insensitive" } },
          { product: { name: { contains: f.q, mode: "insensitive" } } },
        ],
      }
    : {};
  // Low/out filters compare against each variant's own threshold, so they use SQL.
  const levelIds =
    f.level === "out"
      ? (
          await db.$queryRaw<
            { variantId: string }[]
          >`SELECT "variantId" FROM "Inventory" WHERE "quantityOnHand" = 0`
        ).map((r) => r.variantId)
      : f.level === "low"
        ? (
            await db.$queryRaw<
              { variantId: string }[]
            >`SELECT "variantId" FROM "Inventory" WHERE "quantityOnHand" <= "lowStockThreshold"`
          ).map((r) => r.variantId)
        : null;
  const where: Prisma.ProductVariantWhereInput = {
    ...textFilter,
    product: { status: { not: "ARCHIVED" } },
    ...(levelIds ? { id: { in: levelIds } } : {}),
  };

  const [total, variants, movements] = await Promise.all([
    db.productVariant.count({ where }),
    db.productVariant.findMany({
      where,
      orderBy: [{ inventory: { quantityOnHand: "asc" } }, { sku: "asc" }],
      skip: (f.page - 1) * PAGE,
      take: PAGE,
      include: { inventory: true, product: { select: { id: true, name: true } } },
    }),
    db.inventoryTransaction.findMany({
      where: f.reason ? { reason: f.reason as InventoryReason } : {},
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        variant: { select: { sku: true, product: { select: { name: true } } } },
        order: { select: { id: true, orderNumber: true } },
      },
    }),
  ]);

  return (
    <>
      <AdminPageHeader
        title="Inventory"
        description="Stock on hand per variant, low-stock alerts and the stock movement ledger."
      />
      <Card className="gap-0 py-0">
        <FilterBar
          placeholder="SKU, product or variant"
          selects={[
            {
              name: "level",
              label: "Stock levels",
              options: [
                { value: "low", label: "Low stock" },
                { value: "out", label: "Out of stock" },
              ],
            },
          ]}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Alert at</TableHead>
              <TableHead className="text-right">Adjust</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map((v) => {
              const qty = v.inventory?.quantityOnHand ?? 0;
              const low = qty <= (v.inventory?.lowStockThreshold ?? 5);
              return (
                <TableRow key={v.id}>
                  <TableCell>
                    <Link
                      href={`/admin/products/${v.product.id}`}
                      className="font-medium hover:underline"
                    >
                      {v.product.name}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {v.name}
                      {!v.isActive && " · inactive"}
                    </p>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                  <TableCell
                    className={`text-right font-medium tabular-nums ${qty === 0 ? "text-destructive" : low ? "text-brand" : ""}`}
                  >
                    {qty}
                    {low && <span className="sr-only"> (low stock)</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">
                    {v.inventory?.lowStockThreshold ?? 5}
                  </TableCell>
                  <TableCell className="text-right">
                    <StockAdjustButton variantId={v.id} sku={v.sku} onHand={qty} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <AdminPagination
          page={f.page}
          pageCount={Math.max(1, Math.ceil(total / PAGE))}
          total={total}
          basePath="/admin/inventory"
          searchParams={raw}
        />
      </Card>

      <Card className="mt-6 gap-0 py-0">
        <CardHeader className="py-4">
          <CardTitle>Stock movements</CardTitle>
        </CardHeader>
        <FilterBar
          placeholder="(search applies to stock table)"
          selects={[
            {
              name: "reason",
              label: "Reasons",
              options: REASONS.map((r) => ({ value: r, label: r.replace("_", " ").toLowerCase() })),
            },
          ]}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Reference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-muted-foreground">
                  {m.createdAt.toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </TableCell>
                <TableCell>
                  <p className="max-w-56 truncate">{m.variant.product.name}</p>
                  <p className="text-muted-foreground font-mono text-xs">{m.variant.sku}</p>
                </TableCell>
                <TableCell className="text-xs">
                  {m.reason.replace("_", " ").toLowerCase()}
                </TableCell>
                <TableCell
                  className={`text-right font-medium tabular-nums ${m.delta < 0 ? "text-destructive" : "text-success"}`}
                >
                  {m.delta > 0 ? `+${m.delta}` : m.delta}
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.balanceAfter}</TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {m.order ? (
                    <Link href={`/admin/orders/${m.order.id}`} className="hover:underline">
                      {m.order.orderNumber}
                    </Link>
                  ) : (
                    (m.note ?? "—")
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
