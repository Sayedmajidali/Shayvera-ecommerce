import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { z } from "zod";
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
import { formatINR } from "@/lib/money";
import { firstValues } from "@/lib/search-params";
import { listCustomers } from "@/server/modules/customers/admin-customers";
import { requireAdminPage } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "Customers" };

const schema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(["ACTIVE", "DISABLED"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  // Each page authorizes itself: layouts are not re-rendered on client-side navigation.
  await requireAdminPage();
  const raw = firstValues(await searchParams);
  const { customers, total, page, pageCount } = await listCustomers(schema.parse(raw));
  return (
    <>
      <AdminPageHeader
        title="Customers"
        description="Registered customer accounts. Guest orders are listed under Orders."
      />
      <Card className="gap-0 py-0">
        <FilterBar
          placeholder="Name, email or phone"
          selects={[
            {
              name: "status",
              label: "Statuses",
              options: [
                { value: "ACTIVE", label: "Active" },
                { value: "DISABLED", label: "Disabled" },
              ],
            },
          ]}
        />
        {customers.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={Users} title="No customers found" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Spent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/admin/customers/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-muted-foreground text-xs">{c.email}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.phone ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.createdAt.toLocaleDateString("en-IN")}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c._count.orders}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatINR(c.totalSpentPaise)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <AdminPagination
          page={page}
          pageCount={pageCount}
          total={total}
          basePath="/admin/customers"
          searchParams={raw}
        />
      </Card>
    </>
  );
}
