import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { rejectRequest, rejectRequestSchema } from "@/server/modules/orders/requests";

export const POST = adminRoute<RouteCtx<{ id: string }>>(
  "RETURNS_MANAGE",
  async (req, { params }, { actor }) => {
    const { note } = await parseJson(req, rejectRequestSchema);
    await rejectRequest((await params).id, note, actor);
    return ok({ rejected: true });
  },
);
