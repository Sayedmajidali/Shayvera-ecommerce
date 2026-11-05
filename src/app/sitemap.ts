import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { siteConfig } from "@/lib/site";
import { visibleProductWhere } from "@/server/queries/catalog";

// Generated per request from live catalog data (no build-time DB access).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteConfig.url;
  const [products, categories] = await Promise.all([
    db.product.findMany({
      where: visibleProductWhere,
      select: {
        slug: true,
        updatedAt: true,
        images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
      },
    }),
    db.category.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
  ]);
  const staticPages = [
    "",
    "/shop",
    "/about",
    "/contact",
    "/shipping-returns",
    "/privacy",
    "/terms",
  ].map((p) => ({
    url: `${base}${p}`,
    changeFrequency: (p === "" || p === "/shop" ? "daily" : "monthly") as "daily" | "monthly",
    priority: p === "" ? 1 : p === "/shop" ? 0.9 : 0.3,
  }));
  return [
    ...staticPages,
    ...categories.map((c) => ({
      url: `${base}/category/${c.slug}`,
      lastModified: c.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...products.map((p) => ({
      url: `${base}/product/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
      images: p.images.map((i) => new URL(i.url, base).toString()),
    })),
  ];
}
