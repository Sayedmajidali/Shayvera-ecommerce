import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/page-header";
import { RoleManager, StaffManager } from "@/components/admin/staff-manager";
import { PERMISSIONS } from "@/server/modules/auth/permissions";
import { listRoles, listStaff } from "@/server/modules/auth/staff";
import { requireAdminPage } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "Staff & roles" };

export default async function StaffPage() {
  const admin = await requireAdminPage("ADMINS_MANAGE");
  const [staff, roles] = await Promise.all([listStaff(), listRoles()]);
  const roleOptions = roles.map((r) => ({ id: r.id, name: r.name }));
  return (
    <>
      <AdminPageHeader
        title="Staff & roles"
        description="Who can use the admin and what each role is allowed to do. Changes apply on the next page load."
      />
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
