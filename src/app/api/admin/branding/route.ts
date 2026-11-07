import { ok } from "@/lib/api";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { processImageUpload } from "@/server/modules/catalog/image-upload";
import { enforceRateLimit } from "@/server/platform/rate-limit";

/** Uploads a logo or category image (validated + re-encoded). Returns its URL. */
export const POST = adminRoute("SETTINGS_MANAGE", async (req, _ctx, { actor }) => {
  await enforceRateLimit(`upload:${actor.id}`, 60, 600);
  // Refuse oversized bodies before buffering the multipart form.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > env().UPLOAD_MAX_BYTES + 64 * 1024)
    throw new AppError("PAYLOAD_TOO_LARGE", "Upload is too large");
  const form = await req.formData().catch(() => {
    throw new AppError("VALIDATION_ERROR", "Expected a multipart form upload");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", "No file was uploaded");
  const folder = form.get("folder") === "categories" ? "categories" : "branding";
  const image = await processImageUpload(file, folder, env().UPLOAD_MAX_BYTES);
  return ok({ url: image.url, width: image.width, height: image.height }, 201);
});
