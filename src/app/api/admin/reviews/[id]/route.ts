import { z } from "zod";
import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { moderateReview } from "@/server/modules/catalog/reviews";

const schema = z.object({ status: z.enum(["APPROVED", "REJECTED"]) });

/** Approve or reject a customer review (catalogue content → CATALOG_MANAGE). */
export const PATCH = adminRoute<RouteCtx<{ id: string }>>(
  "CATALOG_MANAGE",
  async (req, { params }, { actor }) => {
    const { status } = await parseJson(req, schema);
    return ok(await moderateReview((await params).id, status, actor));
  },
);
