import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "CUSTOMER" | "ADMIN";
  status: "ACTIVE" | "DISABLED";
  phone: string | null;
};

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
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role === "ADMIN" ? "ADMIN" : "CUSTOMER",
    status: "ACTIVE",
    phone: u.phone ?? null,
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

export async function requireAdminPage(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/admin")}`);
  if (user.role !== "ADMIN") redirect("/?denied=1");
  return user;
}

// ── API guards (throw → 401/403 JSON) ──

export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await getUserFromHeaders(req.headers);
  if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in to continue");
  return user;
}

export async function requireAdmin(req: Request): Promise<SessionUser> {
  const user = await requireUser(req);
  if (user.role !== "ADMIN") throw new AppError("FORBIDDEN", "Administrator access required");
  return user;
}
