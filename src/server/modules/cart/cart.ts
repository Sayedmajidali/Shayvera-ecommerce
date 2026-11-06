import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/platform/db";
import { AppError } from "@/lib/errors";
import { loadStoreSettings } from "@/server/modules/settings/queries";
import {
  evaluateCoupon,
  priceCart,
  settingsToPricing,
  type PriceBreakdown,
} from "@/server/modules/pricing/pricing";

export const MAX_QTY_PER_LINE = 10;
export const MAX_LINES = 50;
const GUEST_CART_DAYS = 30;

export type CartIdentity = { userId: string } | { guestToken: string | null };

export function newGuestToken(): string {
  return randomBytes(24).toString("base64url");
}

function whereFor(identity: CartIdentity): Prisma.CartWhereUniqueInput | null {
  if ("userId" in identity) return { userId: identity.userId };
  return identity.guestToken ? { guestToken: identity.guestToken } : null;
}

export async function findCart(identity: CartIdentity) {
  const where = whereFor(identity);
  return where ? db.cart.findUnique({ where }) : null;
}

/** Returns the cart, creating it when needed. `createdToken` is set when a new guest token was issued. */
export async function getOrCreateCart(identity: CartIdentity) {
  const existing = await findCart(identity);
  if (existing) return { cart: existing, createdToken: null as string | null };
  if ("userId" in identity) {
    const cart = await db.cart.upsert({
      where: { userId: identity.userId },
      update: {},
      create: { userId: identity.userId },
    });
    return { cart, createdToken: null };
  }
  const token = newGuestToken();
  const cart = await db.cart.create({
    data: { guestToken: token, expiresAt: new Date(Date.now() + GUEST_CART_DAYS * 86_400_000) },
  });
  return { cart, createdToken: token };
}

const purchasableVariant = {
  isActive: true,
  product: { status: "ACTIVE" as const, category: { isActive: true } },
};

async function loadPurchasableVariant(client: Tx | typeof db, variantId: string) {
  const variant = await client.productVariant.findFirst({
    where: { id: variantId, ...purchasableVariant },
    include: { inventory: true, product: { select: { name: true } } },
  });
  if (!variant) throw new AppError("NOT_FOUND", "This product is no longer available");
  return variant;
}

export async function addItem(identity: CartIdentity, variantId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_LINE) {
    throw new AppError("VALIDATION_ERROR", `Quantity must be between 1 and ${MAX_QTY_PER_LINE}`);
  }
  const { cart, createdToken } = await getOrCreateCart(identity);
  await db.$transaction(async (tx) => {
    const variant = await loadPurchasableVariant(tx, variantId);
    const stock = variant.inventory?.quantityOnHand ?? 0;
    const existing = await tx.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    });
    const desired = (existing?.quantity ?? 0) + quantity;
    if (stock <= 0) throw new AppError("OUT_OF_STOCK", `${variant.product.name} is out of stock`);
    if (desired > stock) {
      throw new AppError(
        "OUT_OF_STOCK",
        `Only ${stock} of ${variant.product.name} available${existing ? ` (you already have ${existing.quantity} in your cart)` : ""}`,
      );
    }
    if (desired > MAX_QTY_PER_LINE) {
      throw new AppError("BUSINESS_RULE", `You can buy up to ${MAX_QTY_PER_LINE} of each item`);
    }
    if (!existing) {
      const lines = await tx.cartItem.count({ where: { cartId: cart.id } });
      if (lines >= MAX_LINES) throw new AppError("BUSINESS_RULE", "Your cart is full");
      await tx.cartItem.create({ data: { cartId: cart.id, variantId, quantity } });
    } else {
      await tx.cartItem.update({ where: { id: existing.id }, data: { quantity: desired } });
    }
    await tx.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
  });
  return { cartId: cart.id, createdToken };
}

async function ownedItem(identity: CartIdentity, itemId: string) {
  const cart = await findCart(identity);
  if (!cart) throw new AppError("NOT_FOUND", "Cart item not found");
  const item = await db.cartItem.findFirst({ where: { id: itemId, cartId: cart.id } });
  if (!item) throw new AppError("NOT_FOUND", "Cart item not found");
  return item;
}

export async function updateItemQuantity(identity: CartIdentity, itemId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QTY_PER_LINE) {
    throw new AppError("VALIDATION_ERROR", `Quantity must be between 0 and ${MAX_QTY_PER_LINE}`);
  }
  const item = await ownedItem(identity, itemId);
  if (quantity === 0) {
    await db.cartItem.delete({ where: { id: item.id } });
    return;
  }
  const variant = await loadPurchasableVariant(db, item.variantId);
  const stock = variant.inventory?.quantityOnHand ?? 0;
  if (quantity > stock) {
    throw new AppError(
      "OUT_OF_STOCK",
      stock > 0 ? `Only ${stock} available` : `${variant.product.name} is out of stock`,
    );
  }
  await db.cartItem.update({ where: { id: item.id }, data: { quantity } });
}

export async function removeItem(identity: CartIdentity, itemId: string) {
  const item = await ownedItem(identity, itemId);
  await db.cartItem.delete({ where: { id: item.id } });
}

export async function customerCouponUsage(
  couponId: string,
  who: { userId?: string | null; email?: string | null },
) {
  if (!who.userId && !who.email) return null;
  return db.couponUsage.count({
    where: {
      couponId,
      OR: [
        ...(who.userId ? [{ userId: who.userId }] : []),
        ...(who.email ? [{ email: who.email.toLowerCase() }] : []),
      ],
    },
  });
}

export async function applyCoupon(identity: CartIdentity, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  const cart = await findCart(identity);
  if (!cart) throw new AppError("BUSINESS_RULE", "Add items to your cart before applying a coupon");
  const view = await getCartView(identity, { couponOverride: code });
  if (!view.coupon.applied)
    throw new AppError("COUPON_INVALID", view.coupon.message ?? "This coupon code is not valid");
  await db.cart.update({ where: { id: cart.id }, data: { couponCode: code } });
  return view;
}

export async function removeCoupon(identity: CartIdentity) {
  const cart = await findCart(identity);
  if (cart) await db.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
}

/** Moves a guest cart's items into the user's cart (quantities summed, capped by stock and line limit). */
export async function mergeGuestCart(userId: string, guestToken: string | null) {
  if (!guestToken) return;
  const guest = await db.cart.findUnique({ where: { guestToken }, include: { items: true } });
  if (!guest) return;
  await db.$transaction(async (tx) => {
    const userCart = await tx.cart.upsert({ where: { userId }, update: {}, create: { userId } });
    for (const item of guest.items) {
      const variant = await tx.productVariant.findFirst({
        where: { id: item.variantId, ...purchasableVariant },
        include: { inventory: true },
      });
      if (!variant) continue;
      const stock = variant.inventory?.quantityOnHand ?? 0;
      const existing = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } },
      });
      const qty = Math.min((existing?.quantity ?? 0) + item.quantity, stock, MAX_QTY_PER_LINE);
      if (qty <= 0) continue;
      if (existing)
        await tx.cartItem.update({ where: { id: existing.id }, data: { quantity: qty } });
      else
        await tx.cartItem.create({
          data: { cartId: userCart.id, variantId: item.variantId, quantity: qty },
        });
    }
    if (!userCart.couponCode && guest.couponCode) {
      await tx.cart.update({ where: { id: userCart.id }, data: { couponCode: guest.couponCode } });
    }
    await tx.cart.delete({ where: { id: guest.id } });
  });
}

export type CartIssue = {
  itemId: string;
  type: "UNAVAILABLE" | "OUT_OF_STOCK" | "INSUFFICIENT_STOCK";
  message: string;
};

export type CartLineView = {
  id: string;
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  variantName: string;
  sku: string;
  imageUrl: string | null;
  unitPricePaise: number;
  compareAtPaise: number | null;
  quantity: number;
  available: number;
  purchasable: boolean;
  taxRateBps: number | null;
  hsnCode: string | null;
  lineTotalPaise: number;
};

export type CartView = {
  id: string | null;
  lines: CartLineView[];
  issues: CartIssue[];
  pricing: PriceBreakdown;
  coupon: { code: string | null; applied: boolean; message: string | null };
  codAvailable: boolean;
  minOrderPaise: number;
};

/**
 * Loads the cart with current catalog prices and stock, validates every line and prices it with the
 * shared engine. Lines that are unavailable or exceed stock are reported as issues and excluded from totals.
 */
export async function getCartView(
  identity: CartIdentity,
  opts: {
    shippingStateCode?: string | null;
    paymentMethod?: "COD" | "RAZORPAY" | null;
    couponOverride?: string | null;
    email?: string | null;
    client?: Tx;
  } = {},
): Promise<CartView> {
  const client = opts.client ?? db;
  const settings = await loadStoreSettings(client);
  const pricingSettings = settingsToPricing(settings);
  const where = whereFor(identity);
  const cart = where
    ? await client.cart.findUnique({
        where,
        include: {
          items: {
            orderBy: { createdAt: "asc" },
            include: {
              variant: {
                include: {
                  inventory: true,
                  product: {
                    include: {
                      category: { select: { isActive: true } },
                      images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
                    },
                  },
                },
              },
            },
          },
        },
      })
    : null;

  const lines: CartLineView[] = [];
  const issues: CartIssue[] = [];
  for (const item of cart?.items ?? []) {
    const v = item.variant;
    const p = v.product;
    const available = v.inventory?.quantityOnHand ?? 0;
    const purchasable = v.isActive && p.status === "ACTIVE" && p.category.isActive;
    if (!purchasable)
      issues.push({
        itemId: item.id,
        type: "UNAVAILABLE",
        message: `${p.name} is no longer available`,
      });
    else if (available <= 0)
      issues.push({
        itemId: item.id,
        type: "OUT_OF_STOCK",
        message: `${p.name} (${v.name}) is out of stock`,
      });
    else if (item.quantity > available) {
      issues.push({
        itemId: item.id,
        type: "INSUFFICIENT_STOCK",
        message: `Only ${available} of ${p.name} (${v.name}) left — please reduce the quantity`,
      });
    }
    lines.push({
      id: item.id,
      variantId: v.id,
      productId: p.id,
      productName: p.name,
      productSlug: p.slug,
      variantName: v.name,
      sku: v.sku,
      imageUrl: p.images[0]?.url ?? null,
      unitPricePaise: v.pricePaise,
      compareAtPaise: v.compareAtPricePaise,
      quantity: item.quantity,
      available,
      purchasable: purchasable && available > 0,
      taxRateBps: p.taxRateBps,
      hsnCode: p.hsnCode,
      lineTotalPaise: v.pricePaise * item.quantity,
    });
  }

  const blocked = new Set(
    issues.filter((i) => i.type !== "INSUFFICIENT_STOCK").map((i) => i.itemId),
  );
  const priceable = lines.filter((l) => !blocked.has(l.id));
  const pricingLines = priceable.map((l) => ({
    key: l.variantId,
    unitPricePaise: l.unitPricePaise,
    compareAtPaise: l.compareAtPaise,
    quantity: Math.min(l.quantity, Math.max(l.available, 1)),
    taxRateBps: l.taxRateBps,
  }));
  const subtotal = pricingLines.reduce((s, l) => s + l.unitPricePaise * l.quantity, 0);

  // Coupon: always re-validated against current state.
  const code = opts.couponOverride ?? cart?.couponCode ?? null;
  let couponDiscount: { code: string; discountPaise: number } | null = null;
  let couponMessage: string | null = null;
  if (code) {
    const coupon = await client.coupon.findUnique({ where: { code } });
    const usage = coupon
      ? await customerCouponUsage(coupon.id, {
          userId: "userId" in identity ? identity.userId : null,
          email: opts.email ?? null,
        })
      : null;
    const result = evaluateCoupon(coupon, {
      subtotalPaise: subtotal,
      now: new Date(),
      customerUsageCount: usage,
    });
    if (result.ok) couponDiscount = { code, discountPaise: result.discountPaise };
    else couponMessage = result.reason;
  }

  const pricing = priceCart({
    lines: pricingLines,
    settings: pricingSettings,
    coupon: couponDiscount,
    shippingStateCode: opts.shippingStateCode ?? null,
    paymentMethod: opts.paymentMethod ?? null,
  });

  const merchandise = pricing.subtotalPaise - pricing.couponDiscountPaise;
  const codAvailable =
    settings.codEnabled &&
    merchandise >= settings.codMinOrderPaise &&
    (settings.codMaxOrderPaise === null ||
      pricing.totalPaise <= settings.codMaxOrderPaise + settings.codFeePaise);

  return {
    id: cart?.id ?? null,
    lines,
    issues,
    pricing,
    coupon: { code, applied: Boolean(couponDiscount), message: couponMessage },
    codAvailable,
    minOrderPaise: settings.minOrderPaise,
  };
}
