import "server-only";
import { route } from "@/lib/api";
import { requireAdmin, type SessionUser } from "@/server/auth/session";
import { clientIp } from "@/server/services/audit";

export type AdminContext = { admin: SessionUser; actor: { id: string; ip: string | null } };

/** Route wrapper that enforces ADMIN role (server-side) before running the handler. */
export function adminRoute<C>(
  handler: (req: Request, ctx: C, admin: AdminContext) => Promise<Response>,
  opts: { csrf?: boolean } = {},
) {
  return route<C>(async (req, ctx) => {
    const admin = await requireAdmin(req);
    return handler(req, ctx, { admin, actor: { id: admin.id, ip: clientIp(req) } });
  }, opts);
}
