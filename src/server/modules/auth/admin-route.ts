import "server-only";
import { route } from "@/lib/api";
import { requireAdmin, type SessionUser } from "@/server/modules/auth/session";
import { clientIp } from "@/server/modules/audit/audit";
import type { Permission } from "@/server/modules/auth/permissions";

export type AdminContext = { admin: SessionUser; actor: { id: string; ip: string | null } };

/**
 * Route wrapper that enforces the ADMIN role and the given permission(s) server-side before the
 * handler runs. Every admin API names the permission it needs, so authorization is reviewable.
 */
export function adminRoute<C>(
  permission: Permission | Permission[],
  handler: (req: Request, ctx: C, admin: AdminContext) => Promise<Response>,
  opts: { csrf?: boolean } = {},
) {
  return route<C>(async (req, ctx) => {
    const admin = await requireAdmin(req, permission);
    return handler(req, ctx, { admin, actor: { id: admin.id, ip: clientIp(req) } });
  }, opts);
}
