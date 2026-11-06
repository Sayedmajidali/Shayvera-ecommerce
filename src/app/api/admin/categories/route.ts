import { ok, parseJson } from "@/lib/api";
import { categoryInputSchema } from "@/lib/validation/catalog";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { createCategory, listCategoriesAdmin } from "@/server/modules/catalog/catalog-admin";

export const GET = adminRoute("CATALOG_MANAGE", async () => ok(await listCategoriesAdmin()), {
  csrf: false,
});

export const POST = adminRoute("CATALOG_MANAGE", async (req, _ctx, { actor }) => {
  const input = await parseJson(req, categoryInputSchema);
  return ok(await createCategory(input, actor), 201);
});
