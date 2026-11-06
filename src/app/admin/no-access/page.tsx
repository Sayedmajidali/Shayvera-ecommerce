import Link from "next/link";
import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { ADMIN_LINKS } from "@/components/admin/admin-links";
import { requireAdminPage } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "No access" };

/** Where staff land when they open a page their role does not include. */
export default async function NoAccessPage() {
  const admin = await requireAdminPage();
  const allowed = ADMIN_LINKS.filter((l) => admin.permissions.includes(l.permission));
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <ShieldAlert className="text-muted-foreground mx-auto size-10" aria-hidden />
      <h1 className="heading-display mt-4 text-3xl">You don’t have access to that page</h1>
      <p className="text-muted-foreground mt-3 text-sm">
        {admin.adminRole
          ? `Your role (${admin.adminRole.name}) doesn’t include it. Ask the store owner if you need it.`
          : "Your account has no staff role yet. Ask the store owner to assign one."}
      </p>
      {allowed.length > 0 && (
        <ul className="mt-8 flex flex-wrap justify-center gap-2">
          {allowed.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="bg-card hover:bg-muted rounded-full border px-4 py-1.5 text-sm"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
