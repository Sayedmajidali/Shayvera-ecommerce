import {
  Boxes,
  ClipboardList,
  FolderTree,
  LayoutDashboard,
  Images,
  Mail,
  MessageSquareText,
  Package,
  ScrollText,
  Settings,
  ShieldCheck,
  TicketPercent,
  Users,
  Undo2,
  CreditCard,
  Truck,
  FileText,
  BarChart3,
  Cog,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/server/modules/auth/permissions";

export type AdminGroup = "overview" | "sales" | "catalog" | "customers" | "store";

/** Sidebar sections, in display order. */
export const ADMIN_GROUPS: { key: AdminGroup; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "sales", label: "Sales" },
  { key: "catalog", label: "Catalog" },
  { key: "customers", label: "Customers" },
  { key: "store", label: "Store" },
];

/** Admin sections and the permission each needs (shared by the nav and the no-access page). */
export const ADMIN_LINKS = [
  {
    href: "/admin",
    group: "overview",
    label: "Dashboard",
    icon: LayoutDashboard,
    permission: "DASHBOARD_VIEW",
  },
  {
    href: "/admin/orders",
    group: "sales",
    label: "Orders",
    icon: ClipboardList,
    permission: "ORDERS_VIEW",
  },
  {
    href: "/admin/requests",
    group: "sales",
    label: "Cancellations & returns",
    icon: Undo2,
    permission: "RETURNS_MANAGE",
  },
  {
    href: "/admin/payments",
    group: "sales",
    label: "Payments",
    icon: CreditCard,
    permission: "PAYMENTS_VIEW",
  },
  {
    href: "/admin/shipments",
    group: "sales",
    label: "Shipments",
    icon: Truck,
    permission: "SHIPPING_MANAGE",
  },
  {
    href: "/admin/invoices",
    group: "sales",
    label: "Invoices",
    icon: FileText,
    permission: "ORDERS_VIEW",
  },
  {
    href: "/admin/reports",
    group: "overview",
    label: "Reports",
    icon: BarChart3,
    permission: "REPORTS_VIEW",
  },
  {
    href: "/admin/products",
    group: "catalog",
    label: "Products",
    icon: Package,
    permission: "CATALOG_MANAGE",
  },
  {
    href: "/admin/categories",
    group: "catalog",
    label: "Categories",
    icon: FolderTree,
    permission: "CATALOG_MANAGE",
  },
  {
    href: "/admin/reviews",
    group: "catalog",
    label: "Reviews",
    icon: MessageSquareText,
    permission: "CATALOG_MANAGE",
  },
  {
    href: "/admin/inventory",
    group: "catalog",
    label: "Inventory",
    icon: Boxes,
    permission: "INVENTORY_MANAGE",
  },
  {
    href: "/admin/customers",
    group: "customers",
    label: "Customers",
    icon: Users,
    permission: "CUSTOMERS_VIEW",
  },
  {
    href: "/admin/coupons",
    group: "customers",
    label: "Coupons",
    icon: TicketPercent,
    permission: "COUPONS_MANAGE",
  },
  {
    href: "/admin/site-images",
    group: "catalog",
    label: "Site images",
    icon: Images,
    permission: "SETTINGS_MANAGE",
  },
  {
    href: "/admin/settings",
    group: "store",
    label: "Settings",
    icon: Settings,
    permission: "SETTINGS_MANAGE",
  },
  {
    href: "/admin/staff",
    group: "store",
    label: "Staff & roles",
    icon: ShieldCheck,
    permission: "ADMINS_MANAGE",
  },
  {
    href: "/admin/audit-log",
    group: "store",
    label: "Audit log",
    icon: ScrollText,
    permission: "AUDIT_VIEW",
  },
  {
    href: "/admin/emails",
    group: "customers",
    label: "Messages & emails",
    icon: Mail,
    permission: "MESSAGES_VIEW",
  },
  {
    href: "/admin/jobs",
    group: "store",
    label: "Background jobs",
    icon: Cog,
    permission: "JOBS_MANAGE",
  },
] as const satisfies readonly {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  group: AdminGroup;
}[];
