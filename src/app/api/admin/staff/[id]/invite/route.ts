import { ok, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { resendInvite } from "@/server/modules/auth/staff";
import { enforceRateLimit } from "@/server/platform/rate-limit";

export const POST = adminRoute<RouteCtx<{ id: string }>>(
  "ADMINS_MANAGE",
  async (_req, { params }, { actor }) => {
    const { id } = await params;
    await enforceRateLimit(`staff-invite-resend:${id}`, 5, 3600);
    await resendInvite(id, actor);
    return ok({ sent: true });
  },
);
