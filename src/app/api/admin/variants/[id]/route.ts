import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { variantInputSchema } from "@/lib/validation/catalog";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { deleteVariant, updateVariant } from "@/server/modules/catalog/catalog-admin";

type Ctx = RouteCtx<{ id: string }>;

export const PUT = adminRoute<Ctx>(async (req, { params }, { actor }) => {
  const input = await parseJson(req, variantInputSchema);
  return ok(await updateVariant((await params).id, input, actor));
});

export const DELETE = adminRoute<Ctx>(async (_req, { params }, { actor }) =>
  ok(await deleteVariant((await params).id, actor)),
);
