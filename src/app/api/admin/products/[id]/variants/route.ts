import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { variantInputSchema } from "@/lib/validation/catalog";
import { adminRoute } from "@/server/auth/admin-route";
import { addVariant } from "@/server/services/catalog-admin";

export const POST = adminRoute<RouteCtx<{ id: string }>>(async (req, { params }, { actor }) => {
  const input = await parseJson(req, variantInputSchema);
  return ok(await addVariant((await params).id, input, actor), 201);
});
