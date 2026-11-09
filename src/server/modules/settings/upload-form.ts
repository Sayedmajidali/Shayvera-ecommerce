import "server-only";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

/** Reads a single-file multipart upload ("file", optional "alt") with an early size check. */
export async function readImageForm(req: Request) {
  const max = env().UPLOAD_MAX_BYTES;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max + 64 * 1024) throw new AppError("PAYLOAD_TOO_LARGE", "Upload is too large");
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
  return { file, alt };
}
