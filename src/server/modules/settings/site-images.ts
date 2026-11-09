import "server-only";
import { cache } from "react";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { SITE_IMAGE_SLOTS, type SiteImages, type SiteImageSlot } from "@/lib/site-images";
import { db } from "@/server/platform/db";
import { logger } from "@/server/platform/logger";
import { storage } from "@/server/platform/storage";
import { audit } from "@/server/modules/audit/audit";
import { processImageUpload } from "@/server/modules/catalog/image-upload";

type Actor = { id: string; ip: string | null };
type Upload = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

/** Uploaded storefront images by slot (React-cached per request). Missing slots use defaults. */
export const getSiteImages = cache(async (): Promise<SiteImages> => {
  const rows = await db.siteImage.findMany();
  return Object.fromEntries(
    rows.map((r) => [r.slot, { url: r.url, width: r.width, height: r.height, alt: r.alt }]),
  ) as SiteImages;
});

/** Deletes a stored upload we own (best effort — a leftover file is harmless, a failed save is not). */
async function deleteStored(url: string | null | undefined) {
  if (!url?.startsWith("/media/")) return;
  const key = url.slice("/media/".length);
  if (!/^(branding|categories)\//.test(key)) return; // never touch product or seed files
  await storage()
    .delete(key)
    .catch((error) => logger.warn("Could not delete replaced image", { key, error }));
}

export async function setSiteImage(slot: SiteImageSlot, file: Upload, alt: string, actor: Actor) {
  const def = SITE_IMAGE_SLOTS.find((s) => s.slot === slot)!;
  const img = await processImageUpload(file, "branding", env().UPLOAD_MAX_BYTES, def.minDimension);
  const previous = await db.siteImage.findUnique({ where: { slot } });
  const row = await db.siteImage.upsert({
    where: { slot },
    create: { slot, key: img.key, url: img.url, width: img.width, height: img.height, alt },
    update: { key: img.key, url: img.url, width: img.width, height: img.height, alt },
  });
  await audit({
    actorId: actor.id,
    action: "site_image.update",
    entityType: "SiteImage",
    entityId: slot,
    metadata: { width: img.width, height: img.height },
    ipAddress: actor.ip,
  });
  if (previous && previous.url !== row.url) await deleteStored(previous.url);
  return { slot, url: row.url, width: row.width, height: row.height, alt: row.alt };
}

export async function resetSiteImage(slot: SiteImageSlot, actor: Actor) {
  const previous = await db.siteImage.findUnique({ where: { slot } });
  if (!previous) return { slot, reset: false };
  await db.siteImage.delete({ where: { slot } });
  await audit({
    actorId: actor.id,
    action: "site_image.reset",
    entityType: "SiteImage",
    entityId: slot,
    ipAddress: actor.ip,
  });
  await deleteStored(previous.url);
  return { slot, reset: true };
}

export async function setCategoryImage(categoryId: string, file: Upload, actor: Actor) {
  const category = await db.category.findUnique({
    where: { id: categoryId },
    select: { id: true, imageUrl: true, name: true },
  });
  if (!category) throw new AppError("NOT_FOUND", "Category not found");
  const img = await processImageUpload(file, "categories", env().UPLOAD_MAX_BYTES);
  await db.category.update({ where: { id: categoryId }, data: { imageUrl: img.url } });
  await audit({
    actorId: actor.id,
    action: "category.image_update",
    entityType: "Category",
    entityId: categoryId,
    ipAddress: actor.ip,
  });
  await deleteStored(category.imageUrl);
  return { id: categoryId, imageUrl: img.url };
}

export async function removeCategoryImage(categoryId: string, actor: Actor) {
  const category = await db.category.findUnique({
    where: { id: categoryId },
    select: { imageUrl: true },
  });
  if (!category) throw new AppError("NOT_FOUND", "Category not found");
  await db.category.update({ where: { id: categoryId }, data: { imageUrl: null } });
  await audit({
    actorId: actor.id,
    action: "category.image_remove",
    entityType: "Category",
    entityId: categoryId,
    ipAddress: actor.ip,
  });
  await deleteStored(category.imageUrl);
  return { id: categoryId, imageUrl: null };
}
