import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { imageUpdateSchema } from "@/lib/validation/catalog";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { deleteImage, updateImageAlt } from "@/server/modules/catalog/catalog-admin";

type Ctx = RouteCtx<{ id: string }>;

export const PATCH = adminRoute<Ctx>(async (req, { params }, { actor }) => {
  const { alt } = await parseJson(req, imageUpdateSchema);
  return ok(await updateImageAlt((await params).id, alt, actor));
});

export const DELETE = adminRoute<Ctx>(async (_req, { params }, { actor }) => {
  await deleteImage((await params).id, actor);
  return ok({ deleted: true });
});
