import type { Metadata } from "next";
import { AdminSidebar, AdminMobileNav } from "@/components/admin/admin-nav";
import { requireAdminPage } from "@/server/auth/session";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Shayvera Admin" },
  robots: { index: false, follow: false },
};

/** Every admin page is guarded server-side here (and again in each admin API). */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdminPage();
  return (
    <div className="bg-muted/40 flex min-h-dvh">
      <AdminSidebar name={admin.name} email={admin.email} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminMobileNav name={admin.name} email={admin.email} />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
