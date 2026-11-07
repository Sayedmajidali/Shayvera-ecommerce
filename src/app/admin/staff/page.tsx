import type { Metadata } from "next";
import Link from "next/link";
import { Activity, MailQuestion, ShieldCheck, UserX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { RoleManager, StaffManager } from "@/components/admin/staff-manager";
import { PERMISSIONS } from "@/server/modules/auth/permissions";
import { listRoles, listStaff, staffActivity } from "@/server/modules/auth/staff";
import { hasPermission } from "@/server/modules/auth/permissions";
import { requireAdminPage } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "Staff & roles" };

export default async function StaffPage() {
  const admin = await requireAdminPage("ADMINS_MANAGE");
  const [staff, roles, activity] = await Promise.all([listStaff(), listRoles(), staffActivity()]);
  const active = staff.filter((s) => s.status === "ACTIVE" && !s.invitePending);
  const totalActions = Object.values(activity.byActor).reduce((t, a) => t + a.actions, 0);
  const dt = (d: Date | null | undefined) =>
    d
      ? d.toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";
  const roleOptions = roles.map((r) => ({ id: r.id, name: r.name }));
  return (
    <>
      <AdminPageHeader
        title="Staff & roles"
        description="Who can use the admin and what each role is allowed to do. Changes apply on the next page load."
      />
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="staff-tiles">
        <StatTile
          icon={ShieldCheck}
          label="Active staff"
          value={String(active.length)}
          hint={`${roles.length} roles`}
        />
        <StatTile
          icon={MailQuestion}
          label="Invitations pending"
          value={String(staff.filter((s) => s.invitePending && s.status === "ACTIVE").length)}
          hint="Password not set yet"
        />
        <StatTile
          icon={UserX}
          label="Disabled"
          value={String(staff.filter((s) => s.status === "DISABLED").length)}
          hint="Cannot sign in"
        />
        <StatTile
          icon={Activity}
          label="Admin actions (30 days)"
          value={String(totalActions)}
          hint="From the audit log"
        />
      </div>
      <Card className="mb-10">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Activity (30 days)</CardTitle>
          {hasPermission(admin.permissions, "AUDIT_VIEW") && (
            <Link
              href="/admin/audit-log"
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              Audit log →
            </Link>
          )}
        </CardHeader>
        <CardContent className="grid gap-6 text-sm md:grid-cols-2">
          <ul className="grid gap-2" aria-label="Actions per staff member">
            {staff.map((s) => {
              const a = activity.byActor[s.id];
              return (
                <li key={s.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{s.name}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {a ? `${a.actions} actions · last ${dt(a.lastActionAt)}` : "No actions"}
                  </span>
                </li>
              );
            })}
          </ul>
          <ul className="grid gap-2" aria-label="Actions by area">
            {activity.byArea.length === 0 && (
              <li className="text-muted-foreground">No admin actions yet.</li>
            )}
            {activity.byArea.map((a) => (
              <li key={a.area} className="flex justify-between gap-3">
                <span>{a.area}</span>
                <span className="tabular-nums">{a.actions}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <div className="grid gap-10">
        <StaffManager
          currentUserId={admin.id}
          roles={roleOptions}
          staff={staff.map((s) => ({
            ...s,
            createdAt: s.createdAt.toISOString(),
            lastActiveAt: s.lastActiveAt?.toISOString() ?? null,
          }))}
        />
        <RoleManager
          catalogue={PERMISSIONS.map((p) => ({ ...p }))}
          roles={roles.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            permissions: r.permissions,
            isSystem: r.isSystem,
            userCount: r.userCount,
          }))}
        />
      </div>
    </>
  );
}
