import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { db } from "@/server/platform/db";
import {
  ALL_PERMISSIONS,
  hasPermission,
  OWNER_ROLE_ID,
  type Permission,
} from "@/server/modules/auth/permissions";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "CUSTOMER" | "ADMIN";
  status: "ACTIVE" | "DISABLED";
  phone: string | null;
  /** Admin permissions from the staff role; empty for customers and role-less admins. */
  permissions: Permission[];
  adminRole: { id: string; name: string } | null;
};

/** Loads the staff role fresh from the database so role changes apply on the next request. */
async function loadAdminRole(userId: string) {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { adminRole: { select: { id: true, name: true, permissions: true } } },
  });
  const role = row?.adminRole;
  if (!role) return { adminRole: null, permissions: [] as Permission[] };
  // The Owner role always has every permission, whatever is stored.
  const permissions =
    role.id === OWNER_ROLE_ID ? ALL_PERMISSIONS : (role.permissions as Permission[]);
  return { adminRole: { id: role.id, name: role.name }, permissions };
}

/** Resolves the session user from request headers. Disabled users are treated as signed out. */
export async function getUserFromHeaders(h: Headers): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: h });
  if (!session) return null;
  const u = session.user as typeof session.user & {
    role?: string;
    status?: string;
    phone?: string | null;
  };
  if (u.status === "DISABLED") return null;
  const isAdmin = u.role === "ADMIN";
  const staff = isAdmin
    ? await loadAdminRole(u.id)
    : { adminRole: null, permissions: [] as Permission[] };
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: isAdmin ? "ADMIN" : "CUSTOMER",
    status: "ACTIVE",
    phone: u.phone ?? null,
    ...staff,
  };
}

/** Current session user for Server Components (deduplicated per request). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> =>
  getUserFromHeaders(await headers()),
);

// ── Page/layout guards (redirect) ──

export async function requireUserPage(returnTo = "/account"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return user;
}

/**
 * Guards an admin page. With a permission, staff lacking it are sent to the "no access" page
 * (which lists what they can open) instead of seeing the page.
 */
export async function requireAdminPage(
  permission?: Permission | Permission[],
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/admin")}`);
  if (user.role !== "ADMIN") redirect("/?denied=1");
  if (permission && !hasPermission(user.permissions, permission)) redirect("/admin/no-access");
  return user;
}

// ── API guards (throw → 401/403 JSON) ──

export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await getUserFromHeaders(req.headers);
  if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in to continue");
  return user;
}

export async function requireAdmin(
  req: Request,
  permission?: Permission | Permission[],
): Promise<SessionUser> {
  const user = await requireUser(req);
  if (user.role !== "ADMIN") throw new AppError("FORBIDDEN", "Administrator access required");
  if (permission && !hasPermission(user.permissions, permission))
    throw new AppError("FORBIDDEN", "You do not have permission to do this");
  return user;
}
