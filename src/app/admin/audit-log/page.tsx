import type { Metadata } from "next";
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
import { db } from "@/server/platform/db";
import { firstValues } from "@/lib/search-params";
import { requireAdminPage } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "Audit log" };
const PAGE = 30;

export default async function AuditLogPage({ searchParams }: PageProps<"/admin/audit-log">) {
  // Each page authorizes itself: layouts are not re-rendered on client-side navigation.
  await requireAdminPage();
  const raw = firstValues(await searchParams);
  const f = z
    .object({
      q: z.string().max(80).optional().catch(undefined),
      page: z.coerce.number().int().min(1).catch(1).default(1),
    })
    .parse(raw);
  const where = f.q
    ? {
        OR: [
          { action: { contains: f.q, mode: "insensitive" as const } },
          { entityType: { contains: f.q, mode: "insensitive" as const } },
          { entityId: f.q },
        ],
      }
    : {};
  const [total, logs] = await Promise.all([
    db.adminAuditLog.count({ where }),
    db.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * PAGE,
      take: PAGE,
      include: { actor: { select: { name: true, email: true } } },
    }),
  ]);
  return (
    <>
      <AdminPageHeader
        title="Audit log"
        description="Every administrative change, who made it and when."
      />
      <Card className="gap-0 py-0">
        <FilterBar placeholder="Action, entity type or id" />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-muted-foreground">
                  {l.createdAt.toLocaleString("en-IN")}
                </TableCell>
                <TableCell>{l.actor?.name ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{l.action}</TableCell>
                <TableCell className="text-xs">
                  {l.entityType}
                  <span className="text-muted-foreground block font-mono">{l.entityId}</span>
                </TableCell>
                <TableCell
                  className="text-muted-foreground max-w-72 truncate font-mono text-xs"
                  title={l.metadata ? JSON.stringify(l.metadata) : ""}
                >
                  {l.metadata ? JSON.stringify(l.metadata) : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {l.ipAddress ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <AdminPagination
          page={f.page}
          pageCount={Math.max(1, Math.ceil(total / PAGE))}
          total={total}
          basePath="/admin/audit-log"
          searchParams={raw}
        />
      </Card>
    </>
  );
}
