import { db } from "@/lib/db";

let seq = 0;

export async function makeCategory(name = "Kitchen") {
  seq++;
  return db.category.create({
    data: { name: `${name} ${seq}`, slug: `${name.toLowerCase()}-${seq}` },
  });
}

export async function makeProduct(
  opts: {
    name?: string;
    categoryId?: string;
    price?: number; // paise
    stock?: number;
    status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
    taxRateBps?: number | null;
    compareAt?: number | null;
    variants?: { sku?: string; name: string; price: number; stock: number }[];
  } = {},
) {
  seq++;
  const categoryId = opts.categoryId ?? (await makeCategory()).id;
  const variants = opts.variants ?? [
    { name: "Default", price: opts.price ?? 50_000, stock: opts.stock ?? 10 },
  ];
  const product = await db.product.create({
    data: {
      name: opts.name ?? `Product ${seq}`,
      slug: `product-${seq}-${Math.random().toString(36).slice(2, 7)}`,
      description: "A test product description",
      categoryId,
      status: opts.status ?? "ACTIVE",
      taxRateBps: opts.taxRateBps === undefined ? 1800 : opts.taxRateBps,
      minPricePaise: Math.min(...variants.map((v) => v.price)),
      variants: {
        create: variants.map((v, i) => ({
          sku: v.sku ?? `SKU-${seq}-${i}`,
          name: v.name,
          pricePaise: v.price,
          compareAtPricePaise: i === 0 ? (opts.compareAt ?? null) : null,
          isDefault: i === 0,
          sortOrder: i,
          inventory: { create: { quantityOnHand: v.stock } },
        })),
      },
    },
    include: { variants: { orderBy: { sortOrder: "asc" } } },
  });
  return product;
}
