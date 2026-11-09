import { randomUUID } from "node:crypto";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import { AppError } from "@/lib/errors";
import { storage } from "@/server/platform/storage";

export const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif"] as const;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "heif"]);
const MIN_DIMENSION = 200;
const MAX_DIMENSION = 8000;
const MAX_PIXELS = 40_000_000;
const OUTPUT_MAX_DIMENSION = 2000;

/** Detects the real file type from magic bytes. */
export function sniffImageType(buf: Buffer): "jpeg" | "png" | "webp" | "avif" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return "webp";
  if (buf.toString("ascii", 4, 8) === "ftyp" && /avif|avis/.test(buf.toString("ascii", 8, 12)))
    return "avif";
  return null;
}

export type ProcessedImage = {
  key: string;
  url: string;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
};

/**
 * Validates an uploaded image without trusting the filename or browser MIME type:
 * size limit → extension allow-list → magic bytes → full decode with sharp (format, dimensions,
 * pixel bomb guard) → re-encode to WebP (strips EXIF/GPS metadata and any appended payload).
 */
export async function processImageUpload(
  file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> },
  folder: "products" | "categories" | "branding",
  maxBytes: number,
  /** Smallest accepted width/height (logos and icons may be smaller than product photos). */
  minDimension = MIN_DIMENSION,
): Promise<ProcessedImage> {
  if (file.size <= 0) throw new AppError("VALIDATION_ERROR", "The file is empty");
  if (file.size > maxBytes) {
    throw new AppError(
      "PAYLOAD_TOO_LARGE",
      `Images must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller`,
    );
  }
  const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new AppError("UNSUPPORTED_MEDIA", "Only JPG, PNG, WebP or AVIF images are allowed");
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", "Image is too large");
  if (!sniffImageType(buf)) {
    throw new AppError("UNSUPPORTED_MEDIA", "The file contents are not a valid image");
  }

  let meta: Metadata;
  try {
    meta = await sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
  } catch {
    throw new AppError("UNSUPPORTED_MEDIA", "The image could not be read. It may be corrupted.");
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    throw new AppError("UNSUPPORTED_MEDIA", "Unsupported image format");
  }
  const { width = 0, height = 0 } = meta;
  if (width < minDimension || height < minDimension) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Images must be at least ${minDimension}×${minDimension} pixels`,
    );
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Images must be at most ${MAX_DIMENSION}px on each side`,
    );
  }

  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: "error" })
      .rotate()
      .resize({
        width: OUTPUT_MAX_DIMENSION,
        height: OUTPUT_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      // Branding (logos, icons) keeps crisp edges and transparency; photos use lossy WebP.
      .webp(
        folder === "branding"
          ? { quality: 92, alphaQuality: 100, smartSubsample: true }
          : { quality: 84 },
      )
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AppError("UNSUPPORTED_MEDIA", "The image could not be processed");
  }

  const key = `${folder}/${randomUUID()}.webp`;
  const stored = await storage().put(key, out.data, "image/webp");
  return {
    key,
    url: stored.url,
    width: out.info.width,
    height: out.info.height,
    sizeBytes: out.data.length,
    mimeType: "image/webp",
  };
}
