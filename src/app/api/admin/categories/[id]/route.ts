import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { categoryInputSchema } from "@/lib/validation/catalog";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { deleteCategory, updateCategory } from "@/server/modules/catalog/catalog-admin";

export const PUT = adminRoute<RouteCtx<{ id: string }>>(
  "CATALOG_MANAGE",
  async (req, { params }, { actor }) => {
    const { id } = await params;
    const input = await parseJson(req, categoryInputSchema);
    return ok(await updateCategory(id, input, actor));
  },
);

export const DELETE = adminRoute<RouteCtx<{ id: string }>>(
  "CATALOG_MANAGE",
  async (_req, { params }, { actor }) => {
    const { id } = await params;
    await deleteCategory(id, actor);
    return ok({ deleted: true });
  },
);
