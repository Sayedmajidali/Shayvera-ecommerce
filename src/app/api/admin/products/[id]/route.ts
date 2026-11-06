import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { productUpdateSchema } from "@/lib/validation/catalog";
import { adminRoute } from "@/server/modules/auth/admin-route";
import {
  deleteOrArchiveProduct,
  getProductAdmin,
  updateProduct,
} from "@/server/modules/catalog/catalog-admin";

type Ctx = RouteCtx<{ id: string }>;

export const GET = adminRoute<Ctx>(
  async (_req, { params }) => ok(await getProductAdmin((await params).id)),
  {
    csrf: false,
  },
);

export const PATCH = adminRoute<Ctx>(async (req, { params }, { actor }) => {
  const input = await parseJson(req, productUpdateSchema, 256 * 1024);
  return ok(await updateProduct((await params).id, input, actor));
});

/** Deletes a never-ordered product, otherwise archives it (order history is preserved). */
export const DELETE = adminRoute<Ctx>(async (_req, { params }, { actor }) =>
  ok(await deleteOrArchiveProduct((await params).id, actor)),
);
