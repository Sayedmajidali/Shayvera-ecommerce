import { ok, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { removeCategoryImage, setCategoryImage } from "@/server/modules/settings/site-images";
import { readImageForm } from "@/server/modules/settings/upload-form";
import { enforceRateLimit } from "@/server/platform/rate-limit";

type Ctx = RouteCtx<{ id: string }>;

/** Upload or replace a category's image (multipart: file). */
export const POST = adminRoute<Ctx>("CATALOG_MANAGE", async (req, { params }, { actor }) => {
  await enforceRateLimit(`upload:${actor.id}`, 60, 600);
  const { file } = await readImageForm(req);
  return ok(await setCategoryImage((await params).id, file, actor), 201);
});

export const DELETE = adminRoute<Ctx>("CATALOG_MANAGE", async (_req, { params }, { actor }) =>
  ok(await removeCategoryImage((await params).id, actor)),
);
