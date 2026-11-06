import { ok } from "@/lib/api";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { processImageUpload } from "@/server/modules/catalog/image-upload";

/** Uploads a logo or category image (validated + re-encoded). Returns its URL. */
export const POST = adminRoute("SETTINGS_MANAGE", async (req) => {
  const form = await req.formData().catch(() => {
    throw new AppError("VALIDATION_ERROR", "Expected a multipart form upload");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", "No file was uploaded");
  const folder = form.get("folder") === "categories" ? "categories" : "branding";
  const image = await processImageUpload(file, folder, env().UPLOAD_MAX_BYTES);
  return ok({ url: image.url, width: image.width, height: image.height }, 201);
});
