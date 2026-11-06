import type { AdminPermission } from "@prisma/client";

/**
 * Admin permission catalogue. Client-safe (no runtime Prisma import) so the admin UI can hide
 * links and buttons — hiding is cosmetic; every page and API re-checks on the server.
 */
export const PERMISSIONS = [
  { key: "DASHBOARD_VIEW", group: "General", label: "View dashboard" },
  { key: "REPORTS_VIEW", group: "General", label: "View sales reports" },
  { key: "ORDERS_VIEW", group: "Orders", label: "View orders" },
  { key: "ORDERS_MANAGE", group: "Orders", label: "Update orders and cancel" },
  { key: "PAYMENTS_VIEW", group: "Payments", label: "View payments" },
  { key: "PAYMENTS_REFUND", group: "Payments", label: "Issue refunds" },
  { key: "SHIPPING_MANAGE", group: "Orders", label: "Create and manage shipments" },
  { key: "RETURNS_MANAGE", group: "Orders", label: "Review cancellation and return requests" },
  { key: "CATALOG_MANAGE", group: "Catalog", label: "Manage products and categories" },
  { key: "INVENTORY_MANAGE", group: "Catalog", label: "Adjust stock" },
  { key: "COUPONS_MANAGE", group: "Catalog", label: "Manage coupons" },
  { key: "CUSTOMERS_VIEW", group: "Customers", label: "View customers" },
  { key: "CUSTOMERS_MANAGE", group: "Customers", label: "Disable or enable customers" },
  { key: "MESSAGES_VIEW", group: "System", label: "View messages and emails" },
  { key: "SETTINGS_MANAGE", group: "System", label: "Change store settings" },
  { key: "AUDIT_VIEW", group: "System", label: "View audit log" },
  { key: "JOBS_MANAGE", group: "System", label: "View and retry background jobs" },
  { key: "ADMINS_MANAGE", group: "System", label: "Manage staff and roles" },
] as const satisfies readonly { key: AdminPermission; group: string; label: string }[];

export type Permission = (typeof PERMISSIONS)[number]["key"];
export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map((p) => p.key);

// Compile-time guarantee that the catalogue lists every Prisma enum value.
type Missing = Exclude<AdminPermission, Permission>;
const _exhaustive: Missing extends never ? true : Missing = true;
void _exhaustive;

export const OWNER_ROLE_ID = "role_owner";

/** Built-in roles. Mirrors the `admin_roles` migration, which seeds them in every environment. */
export const BUILT_IN_ROLES: {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
}[] = [
  {
    id: OWNER_ROLE_ID,
    name: "Owner",
    description: "Full access, including staff and role management.",
    permissions: ALL_PERMISSIONS,
  },
  {
    id: "role_operations",
    name: "Operations",
    description: "Process orders, shipments, returns and stock.",
    permissions: [
      "DASHBOARD_VIEW",
      "ORDERS_VIEW",
      "ORDERS_MANAGE",
      "PAYMENTS_VIEW",
      "SHIPPING_MANAGE",
      "RETURNS_MANAGE",
      "INVENTORY_MANAGE",
      "CUSTOMERS_VIEW",
      "MESSAGES_VIEW",
      "JOBS_MANAGE",
    ],
  },
  {
    id: "role_catalog",
    name: "Catalog",
    description: "Manage products, categories, stock and coupons.",
    permissions: ["DASHBOARD_VIEW", "CATALOG_MANAGE", "INVENTORY_MANAGE", "COUPONS_MANAGE"],
  },
  {
    id: "role_support",
    name: "Support",
    description: "Look up orders and customers; handle returns.",
    permissions: [
      "DASHBOARD_VIEW",
      "ORDERS_VIEW",
      "PAYMENTS_VIEW",
      "RETURNS_MANAGE",
      "CUSTOMERS_VIEW",
      "MESSAGES_VIEW",
    ],
  },
  {
    id: "role_accounts",
    name: "Accounts",
    description: "Payments, refunds and reports.",
    permissions: [
      "DASHBOARD_VIEW",
      "REPORTS_VIEW",
      "ORDERS_VIEW",
      "PAYMENTS_VIEW",
      "PAYMENTS_REFUND",
      "CUSTOMERS_VIEW",
      "AUDIT_VIEW",
    ],
  },
];

export function hasPermission(granted: readonly string[], needed: Permission | Permission[]) {
  const list = Array.isArray(needed) ? needed : [needed];
  return list.every((p) => granted.includes(p));
}
