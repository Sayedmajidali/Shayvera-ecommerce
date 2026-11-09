import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { db, type Tx } from "@/server/platform/db";
import { audit } from "@/server/modules/audit/audit";
import { visibleProductWhere } from "@/server/modules/catalog/queries";

export const reviewInputSchema = z.object({
  rating: z.coerce.number().int().min(1, "Choose a rating").max(5),
  title: z
    .string()
    .trim()
    .max(120, "Keep the title under 120 characters")
    .optional()
    .transform((v) => (v ? v : null)),
  body: z
    .string()
    .trim()
    .min(10, "Tell us a little more (at least 10 characters)")
    .max(2000, "Keep it under 2,000 characters"),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

/** Recomputes the stored rating summary from approved reviews only. */
async function recomputeRating(productId: string, tx: Tx) {
  const agg = await tx.review.aggregate({
    where: { productId, status: "APPROVED" },
    _avg: { rating: true },
    _count: true,
  });
  await tx.product.update({
    where: { id: productId },
    data: { ratingAverage: agg._avg.rating ?? 0, ratingCount: agg._count },
  });
}

/**
 * Creates or edits the customer's review of a product. Every submission (re)enters moderation, so
 * nothing is published without staff approval. "Verified purchase" is set only when the customer
 * has a delivered order containing the product.
 */
export async function submitReview(userId: string, slug: string, input: ReviewInput) {
  const product = await db.product.findFirst({
    where: { slug, ...visibleProductWhere },
    select: { id: true },
  });
  if (!product) throw new AppError("NOT_FOUND", "Product not found");
  const verifiedPurchase =
    (await db.orderItem.count({
      where: { productId: product.id, order: { userId, status: "DELIVERED" } },
    })) > 0;
  return db.$transaction(async (tx) => {
    const review = await tx.review.upsert({
      where: { productId_userId: { productId: product.id, userId } },
      create: { productId: product.id, userId, ...input, verifiedPurchase, status: "PENDING" },
      update: { ...input, verifiedPurchase, status: "PENDING" },
      select: { id: true, status: true, rating: true },
    });
    await recomputeRating(product.id, tx);
    return review;
  });
}

export async function getOwnReview(userId: string, productId: string) {
  return db.review.findUnique({
    where: { productId_userId: { productId, userId } },
    select: { rating: true, title: true, body: true, status: true },
  });
}

export async function moderateReview(
  id: string,
  status: "APPROVED" | "REJECTED",
  actor: { id: string; ip: string | null },
) {
  return db.$transaction(async (tx) => {
    const review = await tx.review.findUnique({
      where: { id },
      select: { productId: true, status: true },
    });
    if (!review) throw new AppError("NOT_FOUND", "Review not found");
    await tx.review.update({ where: { id }, data: { status } });
    await recomputeRating(review.productId, tx);
    await audit(
      {
        actorId: actor.id,
        action: status === "APPROVED" ? "review.approve" : "review.reject",
        entityType: "Review",
        entityId: id,
        metadata: { from: review.status, to: status },
        ipAddress: actor.ip,
      },
      tx,
    );
    return { id, status };
  });
}

export async function listReviewsForAdmin(status: "PENDING" | "APPROVED" | "REJECTED") {
  return db.review.findMany({
    where: { status },
    orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
    take: 100,
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      status: true,
      verifiedPurchase: true,
      createdAt: true,
      user: { select: { name: true } },
      product: { select: { name: true, slug: true } },
    },
  });
}

export async function reviewCounts() {
  const rows = await db.review.groupBy({ by: ["status"], _count: true });
  return Object.fromEntries(rows.map((r) => [r.status, r._count])) as Partial<
    Record<"PENDING" | "APPROVED" | "REJECTED", number>
  >;
}
