import {
  Boxes,
  ClipboardList,
  FolderTree,
  LayoutDashboard,
  Mail,
  Package,
  ScrollText,
  Settings,
  ShieldCheck,
  TicketPercent,
  Users,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/server/modules/auth/permissions";

/** Admin sections and the permission each needs (shared by the nav and the no-access page). */
export const ADMIN_LINKS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, permission: "DASHBOARD_VIEW" },
  { href: "/admin/orders", label: "Orders", icon: ClipboardList, permission: "ORDERS_VIEW" },
  {
    href: "/admin/requests",
    label: "Cancellations & returns",
    icon: Undo2,
    permission: "RETURNS_MANAGE",
  },
  { href: "/admin/products", label: "Products", icon: Package, permission: "CATALOG_MANAGE" },
  {
    href: "/admin/categories",
    label: "Categories",
    icon: FolderTree,
    permission: "CATALOG_MANAGE",
  },
  { href: "/admin/inventory", label: "Inventory", icon: Boxes, permission: "INVENTORY_MANAGE" },
  { href: "/admin/customers", label: "Customers", icon: Users, permission: "CUSTOMERS_VIEW" },
  { href: "/admin/coupons", label: "Coupons", icon: TicketPercent, permission: "COUPONS_MANAGE" },
  { href: "/admin/settings", label: "Settings", icon: Settings, permission: "SETTINGS_MANAGE" },
  { href: "/admin/staff", label: "Staff & roles", icon: ShieldCheck, permission: "ADMINS_MANAGE" },
  { href: "/admin/audit-log", label: "Audit log", icon: ScrollText, permission: "AUDIT_VIEW" },
  { href: "/admin/emails", label: "Messages & emails", icon: Mail, permission: "MESSAGES_VIEW" },
] as const satisfies readonly {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
}[];
