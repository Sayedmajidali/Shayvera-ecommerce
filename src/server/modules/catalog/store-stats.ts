import "server-only";
import { db } from "@/server/platform/db";
import { visibleProductWhere } from "@/server/modules/catalog/queries";

export type StoreStats = {
  products: number;
  categories: number;
  /** Distinct customers (by email) with at least one delivered order. */
  happyKitchens: number;
  ordersDelivered: number;
  /** Average of approved review ratings, or null without reviews. */
  averageRating: number | null;
  reviewCount: number;
};

/** Real figures for the About page — computed from the database, never hard-coded. */
export async function getStoreStats(): Promise<StoreStats> {
  const [products, categories, delivered, kitchens, reviews] = await Promise.all([
    db.product.count({ where: visibleProductWhere }),
    db.category.count({ where: { isActive: true } }),
    db.order.count({ where: { status: "DELIVERED" } }),
    db.order.groupBy({ by: ["email"], where: { status: "DELIVERED" } }),
    db.review.aggregate({ where: { status: "APPROVED" }, _avg: { rating: true }, _count: true }),
  ]);
  return {
    products,
    categories,
    happyKitchens: kitchens.length,
    ordersDelivered: delivered,
    averageRating: reviews._avg.rating,
    reviewCount: reviews._count,
  };
}
