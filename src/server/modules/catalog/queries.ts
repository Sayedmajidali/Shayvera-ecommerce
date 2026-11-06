import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/platform/db";

/** Products visible on the storefront: active, in an active category. */
export const visibleProductWhere: Prisma.ProductWhereInput = {
  status: "ACTIVE",
  category: { isActive: true },
  variants: { some: { isActive: true } },
};

const cardSelect = {
  id: true,
  slug: true,
  name: true,
  brand: true,
  shortDescription: true,
  minPricePaise: true,
  ratingAverage: true,
  ratingCount: true,
  createdAt: true,
  isFeatured: true,
  category: { select: { name: true, slug: true } },
  images: { orderBy: { sortOrder: "asc" }, take: 2, select: { url: true, alt: true } },
  variants: {
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      pricePaise: true,
      compareAtPricePaise: true,
      inventory: { select: { quantityOnHand: true } },
    },
  },
} satisfies Prisma.ProductSelect;

type CardRow = Prisma.ProductGetPayload<{ select: typeof cardSelect }>;

export type ProductCardData = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  categoryName: string;
  images: { url: string; alt: string }[];
  pricePaise: number;
  compareAtPaise: number | null;
  inStock: boolean;
  lowStock: boolean;
  variantCount: number;
  defaultVariantId: string | null;
  rating: number;
  ratingCount: number;
  isNew: boolean;
};

const NEW_DAYS = 21;

function toCard(p: CardRow): ProductCardData {
  const cheapest = [...p.variants].sort((a, b) => a.pricePaise - b.pricePaise)[0];
  const totalStock = p.variants.reduce((s, v) => s + (v.inventory?.quantityOnHand ?? 0), 0);
  const firstInStock = p.variants.find((v) => (v.inventory?.quantityOnHand ?? 0) > 0);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    categoryName: p.category.name,
    images: p.images,
    pricePaise: cheapest?.pricePaise ?? p.minPricePaise,
    compareAtPaise:
      cheapest?.compareAtPricePaise && cheapest.compareAtPricePaise > cheapest.pricePaise
        ? cheapest.compareAtPricePaise
        : null,
    inStock: totalStock > 0,
    lowStock: totalStock > 0 && totalStock <= 5,
    variantCount: p.variants.length,
    defaultVariantId: p.variants.length === 1 ? (firstInStock?.id ?? null) : null,
    rating: p.ratingAverage,
    ratingCount: p.ratingCount,
    isNew: Date.now() - p.createdAt.getTime() < NEW_DAYS * 86_400_000,
  };
}

export const SORT_OPTIONS = {
  featured: "Featured",
  newest: "Newest",
  "price-asc": "Price: Low to high",
  "price-desc": "Price: High to low",
  bestselling: "Bestselling",
  rating: "Top rated",
} as const;
export type SortKey = keyof typeof SORT_OPTIONS;

export const productListParamsSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  category: z.string().trim().max(120).optional().catch(undefined),
  minPrice: z.coerce.number().int().min(0).max(10_000_000).optional().catch(undefined),
  maxPrice: z.coerce.number().int().min(0).max(10_000_000).optional().catch(undefined),
  inStock: z
    .enum(["1", "true"])
    .transform(() => true)
    .optional()
    .catch(undefined),
  sort: z
    .enum(Object.keys(SORT_OPTIONS) as [SortKey, ...SortKey[]])
    .catch("featured")
    .default("featured"),
  page: z.coerce.number().int().min(1).max(1000).catch(1).default(1),
});
export type ProductListParams = z.infer<typeof productListParamsSchema>;

export const PAGE_SIZE = 12;

const orderBy: Record<SortKey, Prisma.ProductOrderByWithRelationInput[]> = {
  featured: [{ isFeatured: "desc" }, { salesCount: "desc" }, { createdAt: "desc" }],
  newest: [{ createdAt: "desc" }],
  "price-asc": [{ minPricePaise: "asc" }, { createdAt: "desc" }],
  "price-desc": [{ minPricePaise: "desc" }, { createdAt: "desc" }],
  bestselling: [{ salesCount: "desc" }, { createdAt: "desc" }],
  rating: [{ ratingAverage: "desc" }, { ratingCount: "desc" }],
};

export function buildProductWhere(params: ProductListParams): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [visibleProductWhere];
  if (params.q) {
    const terms = params.q.split(/\s+/).filter(Boolean).slice(0, 5);
    for (const term of terms) {
      and.push({
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { shortDescription: { contains: term, mode: "insensitive" } },
          { brand: { contains: term, mode: "insensitive" } },
          { category: { name: { contains: term, mode: "insensitive" } } },
          { variants: { some: { sku: { equals: term, mode: "insensitive" } } } },
        ],
      });
    }
  }
  if (params.category) and.push({ category: { slug: params.category } });
  if (params.minPrice !== undefined) and.push({ minPricePaise: { gte: params.minPrice * 100 } });
  if (params.maxPrice !== undefined) and.push({ minPricePaise: { lte: params.maxPrice * 100 } });
  if (params.inStock) {
    and.push({ variants: { some: { isActive: true, inventory: { quantityOnHand: { gt: 0 } } } } });
  }
  return { AND: and };
}

export async function listProducts(params: ProductListParams) {
  const where = buildProductWhere(params);
  const [total, rows] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: orderBy[params.sort],
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: cardSelect,
    }),
  ]);
  return {
    items: rows.map(toCard),
    total,
    page: params.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export const getNavCategories = cache(async () =>
  db.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      imageUrl: true,
      isFeatured: true,
      _count: { select: { products: { where: { status: "ACTIVE" } } } },
    },
  }),
);

export const getCategoryBySlug = cache(async (slug: string) =>
  db.category.findFirst({ where: { slug, isActive: true } }),
);

async function cards(
  where: Prisma.ProductWhereInput,
  order: Prisma.ProductOrderByWithRelationInput[],
  take: number,
) {
  const rows = await db.product.findMany({
    where: { AND: [visibleProductWhere, where] },
    orderBy: order,
    take,
    select: cardSelect,
  });
  return rows.map(toCard);
}

export async function getHomeData() {
  const [categories, featured, bestsellers, newArrivals, testimonials] = await Promise.all([
    getNavCategories(),
    cards({ isFeatured: true }, [{ salesCount: "desc" }], 8),
    cards({}, [{ salesCount: "desc" }], 4),
    cards({}, [{ createdAt: "desc" }], 4),
    db.review.findMany({
      where: { status: "APPROVED", rating: 5, product: visibleProductWhere },
      orderBy: { createdAt: "desc" },
      take: 3,
      distinct: ["userId"],
      select: {
        id: true,
        title: true,
        body: true,
        rating: true,
        user: { select: { name: true } },
        product: { select: { name: true, slug: true } },
      },
    }),
  ]);
  return { categories, featured, bestsellers, newArrivals, testimonials };
}

export const getProductBySlug = cache(async (slug: string) => {
  const product = await db.product.findFirst({
    where: { slug, ...visibleProductWhere },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      images: { orderBy: { sortOrder: "asc" } },
      variants: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        include: { inventory: { select: { quantityOnHand: true } } },
      },
      reviews: {
        where: { status: "APPROVED" },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          rating: true,
          title: true,
          body: true,
          createdAt: true,
          verifiedPurchase: true,
          user: { select: { name: true } },
        },
      },
    },
  });
  if (!product) return null;
  return {
    ...product,
    variants: product.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      name: v.name,
      options: (v.options ?? {}) as Record<string, string>,
      pricePaise: v.pricePaise,
      compareAtPricePaise: v.compareAtPricePaise,
      stock: v.inventory?.quantityOnHand ?? 0,
    })),
  };
});
export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProductBySlug>>>;

export async function getRelatedProducts(productId: string, categoryId: string) {
  return cards({ categoryId, id: { not: productId } }, [{ salesCount: "desc" }], 4);
}

export async function searchSuggestions(q: string) {
  if (q.trim().length < 2) return [];
  const { items } = await listProducts({ q, sort: "bestselling", page: 1 });
  return items.slice(0, 6).map((p) => ({
    slug: p.slug,
    name: p.name,
    image: p.images[0]?.url,
    pricePaise: p.pricePaise,
  }));
}
