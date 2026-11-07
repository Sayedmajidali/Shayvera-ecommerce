import { z } from "zod";
import { ok, parseSearchParams, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { ensureDocument } from "@/server/modules/shipping/shipments";

const q = z.object({ kind: z.enum(["label", "manifest"]) });

/** Returns (generating if needed) the courier label or manifest URL. */
export const GET = adminRoute<RouteCtx<{ id: string }>>(
  "SHIPPING_MANAGE",
  async (req, { params }) => {
    const { kind } = parseSearchParams(req.url, q);
    return ok({ url: await ensureDocument((await params).id, kind) });
  },
  { csrf: false },
);
