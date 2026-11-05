import { ok, parseJson } from "@/lib/api";
import { categoryInputSchema } from "@/lib/validation/catalog";
import { adminRoute } from "@/server/auth/admin-route";
import { createCategory, listCategoriesAdmin } from "@/server/services/catalog-admin";

export const GET = adminRoute(async () => ok(await listCategoriesAdmin()), { csrf: false });

export const POST = adminRoute(async (req, _ctx, { actor }) => {
  const input = await parseJson(req, categoryInputSchema);
  return ok(await createCategory(input, actor), 201);
});
