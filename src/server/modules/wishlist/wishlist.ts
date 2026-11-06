import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { idSchema } from "@/lib/validation/common";
import { db } from "@/server/platform/db";
import { cardSelect, toCard, type ProductCardData } from "@/server/modules/catalog/queries";

export const WISHLIST_LIMIT = 200;

export const wishlistAddSchema = z.object({ productId: idSchema });

/** Product ids on the user's wishlist (for heart buttons). */
export async function wishlistProductIds(userId: string): Promise<string[]> {
  const rows = await db.wishlistItem.findMany({
    where: { userId },
    select: { productId: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => r.productId);
}

export type WishlistEntry = { addedAt: Date; available: boolean; product: ProductCardData };

/** The wishlist with current catalog data. Products no longer on sale are kept but marked unavailable. */
export async function getWishlist(userId: string): Promise<WishlistEntry[]> {
  const rows = await db.wishlistItem.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      product: {
        select: {
          ...cardSelect,
          status: true,
          category: { select: { name: true, slug: true, isActive: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    addedAt: r.createdAt,
    available:
      r.product.status === "ACTIVE" && r.product.category.isActive && r.product.variants.length > 0,
    product: toCard(r.product),
  }));
}

/** Idempotent: adding a product twice keeps one entry. Only products on sale can be added. */
export async function addToWishlist(userId: string, productId: string) {
  const product = await db.product.findFirst({
    where: { id: productId, status: "ACTIVE", category: { isActive: true } },
    select: { id: true },
  });
  if (!product) throw new AppError("NOT_FOUND", "Product not found");
  const count = await db.wishlistItem.count({ where: { userId } });
  if (count >= WISHLIST_LIMIT) {
    const exists = await db.wishlistItem.findUnique({
      where: { userId_productId: { userId, productId } },
    });
    if (!exists)
      throw new AppError(
        "BUSINESS_RULE",
        `Your wishlist can hold up to ${WISHLIST_LIMIT} products`,
      );
  }
  await db.wishlistItem.upsert({
    where: { userId_productId: { userId, productId } },
    create: { userId, productId },
    update: {},
  });
  return { productId, saved: true };
}

export async function removeFromWishlist(userId: string, productId: string) {
  await db.wishlistItem.deleteMany({ where: { userId, productId } });
  return { productId, saved: false };
}
