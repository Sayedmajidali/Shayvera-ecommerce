import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/platform/db";
import { AppError } from "@/lib/errors";
import { slugify } from "@/lib/validation/common";
import type {
  CategoryInput,
  ProductCreateInput,
  ProductUpdateInput,
  VariantInput,
} from "@/lib/validation/catalog";
import { audit } from "@/server/modules/audit/audit";
import { moveStock } from "@/server/modules/inventory/inventory";
import { storage } from "@/server/platform/storage";

type Actor = { id: string; ip?: string | null };

// ───────────────────────────── Helpers ─────────────────────────────

async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base) || "item";
  let candidate = root;
  for (let i = 2; await exists(candidate); i++) candidate = `${root}-${i}`;
  return candidate;
}

/** Keeps the denormalised Product.minPricePaise in sync with active variants. */
export async function recomputeProductPrice(tx: Tx, productId: string) {
  const agg = await tx.productVariant.aggregate({
    where: { productId, isActive: true },
    _min: { pricePaise: true },
  });
  await tx.product.update({
    where: { id: productId },
    data: { minPricePaise: agg._min.pricePaise ?? 0 },
  });
}

// ──────────────────────────── Categories ────────────────────────────

export async function listCategoriesAdmin() {
  return db.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: true } }, parent: { select: { name: true } } },
  });
}

export async function createCategory(input: CategoryInput, actor: Actor) {
  const slug = input.slug
    ? input.slug
    : await uniqueSlug(input.name, async (s) =>
        Boolean(await db.category.findUnique({ where: { slug: s } })),
      );
  if (input.slug && (await db.category.findUnique({ where: { slug } }))) {
    throw new AppError("CONFLICT", "A category with this slug already exists", {
      slug: "Slug already in use",
    });
  }
  return db.$transaction(async (tx) => {
    const category = await tx.category.create({ data: { ...input, slug } });
    await audit(
      {
        actorId: actor.id,
        action: "category.create",
        entityType: "Category",
        entityId: category.id,
        ipAddress: actor.ip,
      },
      tx,
    );
    return category;
  });
}

export async function updateCategory(id: string, input: CategoryInput, actor: Actor) {
  const existing = await db.category.findUnique({ where: { id } });
  if (!existing) throw new AppError("NOT_FOUND", "Category not found");
  if (input.parentId === id)
    throw new AppError("VALIDATION_ERROR", "A category cannot be its own parent");
  const slug = input.slug ?? existing.slug;
  if (slug !== existing.slug && (await db.category.findUnique({ where: { slug } }))) {
    throw new AppError("CONFLICT", "A category with this slug already exists", {
      slug: "Slug already in use",
    });
  }
  return db.$transaction(async (tx) => {
    const category = await tx.category.update({ where: { id }, data: { ...input, slug } });
    await audit(
      {
        actorId: actor.id,
        action: "category.update",
        entityType: "Category",
        entityId: id,
        ipAddress: actor.ip,
      },
      tx,
    );
    return category;
  });
}

export async function deleteCategory(id: string, actor: Actor) {
  const category = await db.category.findUnique({
    where: { id },
    include: { _count: { select: { products: true } } },
  });
  if (!category) throw new AppError("NOT_FOUND", "Category not found");
  if (category._count.products > 0) {
    throw new AppError(
      "CONFLICT",
      `This category has ${category._count.products} product(s). Move them to another category or deactivate the category instead.`,
    );
  }
  await db.$transaction(async (tx) => {
    await tx.category.delete({ where: { id } });
    await audit(
      {
        actorId: actor.id,
        action: "category.delete",
        entityType: "Category",
        entityId: id,
        metadata: { name: category.name },
        ipAddress: actor.ip,
      },
      tx,
    );
  });
}

// ───────────────────────────── Products ─────────────────────────────

export type AdminProductFilters = {
  q?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  categoryId?: string;
  stock?: "out" | "low";
  page: number;
  pageSize: number;
};

export async function listProductsAdmin(f: AdminProductFilters) {
  const where: Prisma.ProductWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.q
      ? {
          OR: [
            { name: { contains: f.q, mode: "insensitive" } },
            { slug: { contains: f.q, mode: "insensitive" } },
            { variants: { some: { sku: { contains: f.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
    ...(f.stock === "out"
      ? { variants: { every: { OR: [{ isActive: false }, { inventory: { quantityOnHand: 0 } }] } } }
      : {}),
  };
  const [total, items] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        category: { select: { name: true } },
        images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
        variants: {
          select: {
            id: true,
            sku: true,
            isActive: true,
            pricePaise: true,
            inventory: { select: { quantityOnHand: true, lowStockThreshold: true } },
          },
        },
      },
    }),
  ]);
  return { total, items, page: f.page, pageCount: Math.max(1, Math.ceil(total / f.pageSize)) };
}

export async function getProductAdmin(id: string) {
  const product = await db.product.findUnique({
    where: { id },
    include: {
      category: true,
      images: { orderBy: { sortOrder: "asc" } },
      variants: { orderBy: { sortOrder: "asc" }, include: { inventory: true } },
      _count: { select: { orderItems: true } },
    },
  });
  if (!product) throw new AppError("NOT_FOUND", "Product not found");
  return product;
}

async function assertSkusAvailable(tx: Tx, variants: VariantInput[], productId?: string) {
  const skus = variants.map((v) => v.sku);
  const dupInPayload = skus.find((s, i) => skus.indexOf(s) !== i);
  if (dupInPayload) throw new AppError("CONFLICT", `Duplicate SKU in request: ${dupInPayload}`);
  const clash = await tx.productVariant.findFirst({
    where: { sku: { in: skus }, ...(productId ? { NOT: { productId } } : {}) },
    select: { sku: true },
  });
  if (clash) throw new AppError("CONFLICT", `SKU ${clash.sku} is already used by another product`);
}

export async function createProduct(input: ProductCreateInput, actor: Actor) {
  const category = await db.category.findUnique({ where: { id: input.categoryId } });
  if (!category)
    throw new AppError("VALIDATION_ERROR", "Category does not exist", {
      categoryId: "Select a valid category",
    });
  const slug = input.slug
    ? input.slug
    : await uniqueSlug(input.name, async (s) =>
        Boolean(await db.product.findUnique({ where: { slug: s } })),
      );
  if (input.slug && (await db.product.findUnique({ where: { slug } }))) {
    throw new AppError("CONFLICT", "A product with this slug already exists", {
      slug: "Slug already in use",
    });
  }

  return db.$transaction(async (tx) => {
    await assertSkusAvailable(tx, input.variants);
    const { variants, ...data } = input;
    const product = await tx.product.create({
      data: { ...data, slug },
    });
    for (const [i, v] of variants.entries()) {
      await createVariantTx(tx, product.id, v, i, actor);
    }
    await recomputeProductPrice(tx, product.id);
    await audit(
      {
        actorId: actor.id,
        action: "product.create",
        entityType: "Product",
        entityId: product.id,
        metadata: { name: product.name },
        ipAddress: actor.ip,
      },
      tx,
    );
    return tx.product.findUniqueOrThrow({ where: { id: product.id } });
  });
}

async function createVariantTx(
  tx: Tx,
  productId: string,
  v: VariantInput,
  sortOrder: number,
  actor: Actor,
) {
  const variant = await tx.productVariant.create({
    data: {
      productId,
      sku: v.sku,
      name: v.name,
      options: v.options,
      pricePaise: v.pricePaise,
      compareAtPricePaise: v.compareAtPricePaise ?? null,
      weightGrams: v.weightGrams ?? null,
      isActive: v.isActive,
      isDefault: sortOrder === 0,
      sortOrder,
      inventory: { create: { quantityOnHand: 0, lowStockThreshold: v.lowStockThreshold ?? 5 } },
    },
  });
  if (v.initialStock && v.initialStock > 0) {
    await moveStock(tx, {
      variantId: variant.id,
      delta: v.initialStock,
      reason: "INITIAL",
      actorId: actor.id,
      note: "Initial stock",
    });
  }
  return variant;
}

export async function updateProduct(id: string, input: ProductUpdateInput, actor: Actor) {
  const existing = await db.product.findUnique({ where: { id } });
  if (!existing) throw new AppError("NOT_FOUND", "Product not found");
  if (
    input.slug &&
    input.slug !== existing.slug &&
    (await db.product.findUnique({ where: { slug: input.slug } }))
  ) {
    throw new AppError("CONFLICT", "A product with this slug already exists", {
      slug: "Slug already in use",
    });
  }
  if (input.categoryId && !(await db.category.findUnique({ where: { id: input.categoryId } }))) {
    throw new AppError("VALIDATION_ERROR", "Category does not exist", {
      categoryId: "Select a valid category",
    });
  }
  if (input.status === "ACTIVE") {
    const activeVariants = await db.productVariant.count({
      where: { productId: id, isActive: true },
    });
    if (activeVariants === 0)
      throw new AppError("BUSINESS_RULE", "Add an active variant before publishing");
  }
  return db.$transaction(async (tx) => {
    const product = await tx.product.update({ where: { id }, data: input });
    const changed = Object.keys(input).filter(
      (k) =>
        JSON.stringify((existing as Record<string, unknown>)[k]) !==
        JSON.stringify((input as Record<string, unknown>)[k]),
    );
    await audit(
      {
        actorId: actor.id,
        action: "product.update",
        entityType: "Product",
        entityId: id,
        metadata: { changed },
        ipAddress: actor.ip,
      },
      tx,
    );
    return product;
  });
}

/** Hard delete only when the product has never been ordered; otherwise archive. */
export async function deleteOrArchiveProduct(
  id: string,
  actor: Actor,
): Promise<{ action: "deleted" | "archived" }> {
  const product = await db.product.findUnique({
    where: { id },
    include: { _count: { select: { orderItems: true } }, images: { select: { storageKey: true } } },
  });
  if (!product) throw new AppError("NOT_FOUND", "Product not found");
  if (product._count.orderItems > 0) {
    await db.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: { status: "ARCHIVED", isFeatured: false } });
      await tx.cartItem.deleteMany({ where: { variant: { productId: id } } });
      await audit(
        {
          actorId: actor.id,
          action: "product.archive",
          entityType: "Product",
          entityId: id,
          ipAddress: actor.ip,
        },
        tx,
      );
    });
    return { action: "archived" };
  }
  await db.$transaction(async (tx) => {
    await tx.product.delete({ where: { id } });
    await audit(
      {
        actorId: actor.id,
        action: "product.delete",
        entityType: "Product",
        entityId: id,
        metadata: { name: product.name },
        ipAddress: actor.ip,
      },
      tx,
    );
  });
  for (const img of product.images) {
    if (img.storageKey)
      await storage()
        .delete(img.storageKey)
        .catch(() => undefined);
  }
  return { action: "deleted" };
}

// ───────────────────────────── Variants ─────────────────────────────

export async function addVariant(productId: string, input: VariantInput, actor: Actor) {
  return db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      include: { _count: { select: { variants: true } } },
    });
    if (!product) throw new AppError("NOT_FOUND", "Product not found");
    await assertSkusAvailable(tx, [input]);
    const variant = await createVariantTx(tx, productId, input, product._count.variants, actor);
    await recomputeProductPrice(tx, productId);
    await audit(
      {
        actorId: actor.id,
        action: "variant.create",
        entityType: "ProductVariant",
        entityId: variant.id,
        metadata: { sku: variant.sku },
        ipAddress: actor.ip,
      },
      tx,
    );
    return variant;
  });
}

export async function updateVariant(variantId: string, input: VariantInput, actor: Actor) {
  return db.$transaction(async (tx) => {
    const existing = await tx.productVariant.findUnique({ where: { id: variantId } });
    if (!existing) throw new AppError("NOT_FOUND", "Variant not found");
    await assertSkusAvailable(tx, [input], existing.productId);
    const clash = await tx.productVariant.findFirst({
      where: { sku: input.sku, NOT: { id: variantId } },
    });
    if (clash) throw new AppError("CONFLICT", `SKU ${input.sku} is already in use`);
    if (!input.isActive) {
      const others = await tx.productVariant.count({
        where: { productId: existing.productId, isActive: true, NOT: { id: variantId } },
      });
      const product = await tx.product.findUniqueOrThrow({ where: { id: existing.productId } });
      if (others === 0 && product.status === "ACTIVE") {
        throw new AppError("BUSINESS_RULE", "An active product needs at least one active variant");
      }
    }
    const variant = await tx.productVariant.update({
      where: { id: variantId },
      data: {
        sku: input.sku,
        name: input.name,
        options: input.options,
        pricePaise: input.pricePaise,
        compareAtPricePaise: input.compareAtPricePaise ?? null,
        weightGrams: input.weightGrams ?? null,
        isActive: input.isActive,
      },
    });
    if (input.lowStockThreshold !== undefined) {
      await tx.inventory.update({
        where: { variantId },
        data: { lowStockThreshold: input.lowStockThreshold },
      });
    }
    if (!input.isActive) await tx.cartItem.deleteMany({ where: { variantId } });
    await recomputeProductPrice(tx, existing.productId);
    await audit(
      {
        actorId: actor.id,
        action: "variant.update",
        entityType: "ProductVariant",
        entityId: variantId,
        metadata: { sku: input.sku, priceFrom: existing.pricePaise, priceTo: input.pricePaise },
        ipAddress: actor.ip,
      },
      tx,
    );
    return variant;
  });
}

export async function deleteVariant(
  variantId: string,
  actor: Actor,
): Promise<{ action: "deleted" | "deactivated" }> {
  const variant = await db.productVariant.findUnique({
    where: { id: variantId },
    include: {
      _count: { select: { orderItems: true } },
      product: { include: { _count: { select: { variants: true } } } },
    },
  });
  if (!variant) throw new AppError("NOT_FOUND", "Variant not found");
  if (variant.product._count.variants <= 1) {
    throw new AppError("BUSINESS_RULE", "A product must have at least one variant");
  }
  return db.$transaction(async (tx) => {
    if (variant._count.orderItems > 0) {
      await tx.productVariant.update({ where: { id: variantId }, data: { isActive: false } });
      await tx.cartItem.deleteMany({ where: { variantId } });
      await recomputeProductPrice(tx, variant.productId);
      await audit(
        {
          actorId: actor.id,
          action: "variant.deactivate",
          entityType: "ProductVariant",
          entityId: variantId,
          ipAddress: actor.ip,
        },
        tx,
      );
      return { action: "deactivated" as const };
    }
    await tx.productVariant.delete({ where: { id: variantId } });
    await recomputeProductPrice(tx, variant.productId);
    await audit(
      {
        actorId: actor.id,
        action: "variant.delete",
        entityType: "ProductVariant",
        entityId: variantId,
        metadata: { sku: variant.sku },
        ipAddress: actor.ip,
      },
      tx,
    );
    return { action: "deleted" as const };
  });
}

// ────────────────────────────── Images ──────────────────────────────

const MAX_IMAGES = 12;

export async function addProductImage(
  productId: string,
  image: {
    url: string;
    key: string;
    width: number;
    height: number;
    sizeBytes: number;
    mimeType: string;
  },
  alt: string,
  actor: Actor,
) {
  return db.$transaction(async (tx) => {
    const count = await tx.productImage.count({ where: { productId } });
    if (count >= MAX_IMAGES)
      throw new AppError("BUSINESS_RULE", `A product can have at most ${MAX_IMAGES} images`);
    const created = await tx.productImage.create({
      data: {
        productId,
        url: image.url,
        storageKey: image.key,
        width: image.width,
        height: image.height,
        sizeBytes: image.sizeBytes,
        mimeType: image.mimeType,
        alt,
        sortOrder: count,
      },
    });
    await audit(
      {
        actorId: actor.id,
        action: "image.upload",
        entityType: "Product",
        entityId: productId,
        metadata: { imageId: created.id },
        ipAddress: actor.ip,
      },
      tx,
    );
    return created;
  });
}

export async function updateImageAlt(imageId: string, alt: string, actor: Actor) {
  const image = await db.productImage.findUnique({ where: { id: imageId } });
  if (!image) throw new AppError("NOT_FOUND", "Image not found");
  const updated = await db.productImage.update({ where: { id: imageId }, data: { alt } });
  await audit({
    actorId: actor.id,
    action: "image.update",
    entityType: "Product",
    entityId: image.productId,
    ipAddress: actor.ip,
  });
  return updated;
}

export async function deleteImage(imageId: string, actor: Actor) {
  const image = await db.productImage.findUnique({ where: { id: imageId } });
  if (!image) throw new AppError("NOT_FOUND", "Image not found");
  await db.$transaction(async (tx) => {
    await tx.productImage.delete({ where: { id: imageId } });
    const rest = await tx.productImage.findMany({
      where: { productId: image.productId },
      orderBy: { sortOrder: "asc" },
    });
    for (const [i, img] of rest.entries()) {
      if (img.sortOrder !== i)
        await tx.productImage.update({ where: { id: img.id }, data: { sortOrder: i } });
    }
    await audit(
      {
        actorId: actor.id,
        action: "image.delete",
        entityType: "Product",
        entityId: image.productId,
        ipAddress: actor.ip,
      },
      tx,
    );
  });
  if (image.storageKey)
    await storage()
      .delete(image.storageKey)
      .catch(() => undefined);
}

export async function reorderImages(productId: string, order: string[], actor: Actor) {
  const images = await db.productImage.findMany({ where: { productId }, select: { id: true } });
  const ids = new Set(images.map((i) => i.id));
  if (order.length !== ids.size || !order.every((id) => ids.has(id))) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Image order must include every image of this product exactly once",
    );
  }
  await db.$transaction([
    ...order.map((id, i) => db.productImage.update({ where: { id }, data: { sortOrder: i } })),
  ]);
  await audit({
    actorId: actor.id,
    action: "image.reorder",
    entityType: "Product",
    entityId: productId,
    ipAddress: actor.ip,
  });
}
