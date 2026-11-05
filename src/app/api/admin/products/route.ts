import { z } from "zod";
import { ok, parseJson, parseSearchParams } from "@/lib/api";
import { productCreateSchema } from "@/lib/validation/catalog";
import { paginationSchema } from "@/lib/validation/common";
import { adminRoute } from "@/server/auth/admin-route";
import { createProduct, listProductsAdmin } from "@/server/services/catalog-admin";

const filtersSchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  categoryId: z.string().max(64).optional(),
  stock: z.enum(["out", "low"]).optional(),
});

export const GET = adminRoute(
  async (req) => ok(await listProductsAdmin(parseSearchParams(req.url, filtersSchema))),
  {
    csrf: false,
  },
);

export const POST = adminRoute(async (req, _ctx, { actor }) => {
  const input = await parseJson(req, productCreateSchema, 256 * 1024);
  return ok(await createProduct(input, actor), 201);
});
