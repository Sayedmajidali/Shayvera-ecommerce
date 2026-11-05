import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { imageReorderSchema } from "@/lib/validation/catalog";
import { adminRoute } from "@/server/auth/admin-route";
import { addProductImage, reorderImages } from "@/server/services/catalog-admin";
import { processImageUpload } from "@/server/services/image-upload";
import { enforceRateLimit } from "@/server/services/rate-limit";
import { db } from "@/lib/db";

type Ctx = RouteCtx<{ id: string }>;

/** multipart/form-data: file (required), alt (optional). */
export const POST = adminRoute<Ctx>(async (req, { params }, { actor }) => {
  const { id } = await params;
  await enforceRateLimit(`upload:${actor.id}`, 60, 600);
  const max = env().UPLOAD_MAX_BYTES;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max + 64 * 1024) throw new AppError("PAYLOAD_TOO_LARGE", "Upload is too large");
  if (!(await db.product.findUnique({ where: { id }, select: { id: true } }))) {
    throw new AppError("NOT_FOUND", "Product not found");
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Expected a multipart form upload");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", "No file was uploaded");
  const alt = String(form.get("alt") ?? "")
    .trim()
    .slice(0, 160);
  const processed = await processImageUpload(file, "products", max);
  return ok(await addProductImage(id, processed, alt, actor), 201);
});

export const PATCH = adminRoute<Ctx>(async (req, { params }, { actor }) => {
  const { order } = await parseJson(req, imageReorderSchema);
  await reorderImages((await params).id, order, actor);
  return ok({ reordered: true });
});
