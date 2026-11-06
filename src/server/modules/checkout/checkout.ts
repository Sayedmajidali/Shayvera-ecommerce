import { Prisma } from "@prisma/client";
import { db } from "@/server/platform/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/server/platform/logger";
import type { CheckoutInput } from "@/lib/validation/checkout";
import { isOnlinePaymentConfigured } from "@/server/modules/payments/gateway";
import { loadStoreSettings } from "@/server/modules/settings/queries";
import { getCartView, type CartIdentity } from "@/server/modules/cart/cart";
import { reserveStock } from "@/server/modules/inventory/inventory";
import { orderAccessToken } from "@/server/modules/orders/order-access";
import { transitionOrder } from "@/server/modules/orders/orders";
import { startOnlinePayment, type OnlinePaymentSession } from "@/server/modules/payments/payments";
import { nextOrderNumber } from "@/server/platform/sequence";
import { checkDelivery } from "@/server/modules/shipping/serviceability";

export type CheckoutContext = { identity: CartIdentity; userId: string | null };

export type CheckoutResult = {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentMethod: "COD" | "RAZORPAY";
  totalPaise: number;
  accessToken: string;
  payment: OnlinePaymentSession | null;
  idempotentReplay: boolean;
};

async function existingForKey(
  key: string,
  ctx: CheckoutContext,
  email: string,
): Promise<CheckoutResult | null> {
  const order = await db.order.findUnique({ where: { idempotencyKey: key } });
  if (!order) return null;
  const sameOwner = ctx.userId
    ? order.userId === ctx.userId
    : order.userId === null && order.email === email;
  if (!sameOwner)
    throw new AppError(
      "CONFLICT",
      "This checkout session is no longer valid. Please refresh and try again.",
    );
  let payment: OnlinePaymentSession | null = null;
  if (
    order.paymentMethod === "RAZORPAY" &&
    order.status === "PENDING" &&
    order.paymentStatus !== "PAID"
  ) {
    payment = await startOnlinePayment(order.id).catch(() => null);
  }
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    totalPaise: order.totalPaise,
    accessToken: orderAccessToken(order.id),
    payment,
    idempotentReplay: true,
  };
}

/**
 * Places an order from the current cart. Everything that affects money or stock happens in one
 * database transaction; the client never supplies prices or totals.
 *
 * Idempotency: the client generates one UUID per checkout attempt. A repeated submission returns
 * the original order (double-click, network retry). The unique constraint on Order.idempotencyKey
 * guarantees this even for concurrent duplicates.
 */
export async function placeOrder(
  input: CheckoutInput,
  ctx: CheckoutContext,
): Promise<CheckoutResult> {
  const replay = await existingForKey(input.idempotencyKey, ctx, input.email);
  if (replay) return replay;

  const settings = await loadStoreSettings();
  if (input.paymentMethod === "RAZORPAY" && !isOnlinePaymentConfigured()) {
    throw new AppError(
      "BUSINESS_RULE",
      "Online payment is currently unavailable. Please choose Cash on Delivery.",
    );
  }
  if (input.paymentMethod === "COD") {
    if (!settings.codEnabled)
      throw new AppError("BUSINESS_RULE", "Cash on Delivery is currently unavailable");
    if (settings.codBlockedPincodes.includes(input.shippingAddress.pincode)) {
      throw new AppError("BUSINESS_RULE", "Cash on Delivery is not available for this PIN code", {
        paymentMethod: "COD is not available for this PIN code",
      });
    }
  }

  const shipping = input.shippingAddress;
  const billing =
    input.billingSameAsShipping || !input.billingAddress ? shipping : input.billingAddress;

  // Courier coverage (outside the transaction: network call with a 3 s budget and a 6 h cache).
  const preview = await getCartView(ctx.identity, {
    email: input.email,
    ...(input.buyNow ? { buyNow: input.buyNow, couponOverride: input.couponCode } : {}),
  });
  const delivery = await checkDelivery(
    shipping.pincode,
    preview.lines
      .filter((l) => l.purchasable)
      .map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity,
        unitPricePaise: l.unitPricePaise,
      })),
  );
  if (delivery.status === "not_serviceable") {
    throw new AppError("BUSINESS_RULE", "Sorry, we don’t deliver to this PIN code yet", {
      "shippingAddress.pincode": "We don’t deliver to this PIN code yet",
    });
  }
  if (
    input.paymentMethod === "COD" &&
    delivery.status === "serviceable" &&
    !delivery.codAvailable
  ) {
    throw new AppError("BUSINESS_RULE", "Cash on Delivery is not available for this PIN code", {
      paymentMethod: "COD is not available for this PIN code — please pay online",
    });
  }

  let created: { id: string; orderNumber: string; status: string; totalPaise: number };
  try {
    created = await db.$transaction(
      async (tx) => {
        const view = await getCartView(ctx.identity, {
          client: tx,
          shippingStateCode: shipping.stateCode,
          paymentMethod: input.paymentMethod,
          email: input.email,
          ...(input.buyNow ? { buyNow: input.buyNow, couponOverride: input.couponCode } : {}),
        });
        if (view.lines.length === 0)
          throw new AppError(
            "BUSINESS_RULE",
            input.buyNow ? "This product is no longer available" : "Your cart is empty",
          );
        if (view.issues.length > 0) {
          throw new AppError("OUT_OF_STOCK", view.issues[0]!.message, { issues: view.issues });
        }
        if (view.coupon.code && !view.coupon.applied) {
          throw new AppError(
            "COUPON_INVALID",
            view.coupon.message ?? "Your coupon is no longer valid. Remove it to continue.",
          );
        }
        const p = view.pricing;
        if (p.subtotalPaise - p.couponDiscountPaise < settings.minOrderPaise) {
          throw new AppError(
            "BUSINESS_RULE",
            `The minimum order value is ₹${settings.minOrderPaise / 100}`,
          );
        }
        if (input.paymentMethod === "COD") {
          if (p.subtotalPaise - p.couponDiscountPaise < settings.codMinOrderPaise) {
            throw new AppError(
              "BUSINESS_RULE",
              "This order is below the minimum value for Cash on Delivery",
            );
          }
          if (
            settings.codMaxOrderPaise !== null &&
            p.totalPaise > settings.codMaxOrderPaise + settings.codFeePaise
          ) {
            throw new AppError(
              "BUSINESS_RULE",
              "This order exceeds the Cash on Delivery limit. Please pay online.",
            );
          }
        }

        const orderNumber = await nextOrderNumber(tx, settings.orderPrefix);
        const byVariant = new Map(view.lines.map((l) => [l.variantId, l]));
        const isCod = input.paymentMethod === "COD";
        const order = await tx.order.create({
          data: {
            orderNumber,
            userId: ctx.userId,
            email: input.email,
            phone: input.phone,
            status: "PENDING",
            paymentMethod: input.paymentMethod,
            paymentStatus: "PENDING",
            shippingAddress: shipping,
            billingAddress: billing,
            shippingStateCode: shipping.stateCode,
            subtotalPaise: p.subtotalPaise,
            discountPaise: p.couponDiscountPaise,
            couponCode: p.couponCode,
            couponDiscountPaise: p.couponDiscountPaise,
            shippingPaise: p.shippingPaise,
            codFeePaise: p.codFeePaise,
            taxPaise: p.taxPaise,
            cgstPaise: p.cgstPaise,
            sgstPaise: p.sgstPaise,
            igstPaise: p.igstPaise,
            pricesIncludeTax: p.taxInclusive,
            totalPaise: p.totalPaise,
            customerNote: input.customerNote,
            idempotencyKey: input.idempotencyKey,
            // UNVERIFIED = courier check unavailable at checkout; staff confirm coverage before shipping.
            deliveryCheck:
              delivery.status === "serviceable"
                ? "SERVICEABLE"
                : delivery.status === "unverified"
                  ? "UNVERIFIED"
                  : "SKIPPED",
            deliveryEtaDays: delivery.status === "serviceable" ? delivery.etaDays : null,
            paymentExpiresAt: isCod
              ? null
              : new Date(Date.now() + env().PAYMENT_EXPIRY_MINUTES * 60_000),
            items: {
              create: p.lines.map((pl) => {
                const l = byVariant.get(pl.key)!;
                return {
                  productId: l.productId,
                  variantId: l.variantId,
                  productName: l.productName,
                  productSlug: l.productSlug,
                  variantName: l.variantName,
                  sku: l.sku,
                  imageUrl: l.imageUrl,
                  hsnCode: l.hsnCode,
                  unitPricePaise: pl.unitPricePaise,
                  compareAtPaise: l.compareAtPaise,
                  quantity: pl.quantity,
                  lineSubtotalPaise: pl.lineSubtotalPaise,
                  discountPaise: pl.discountPaise,
                  taxRateBps: pl.taxRateBps,
                  taxPaise: pl.taxPaise,
                  lineTotalPaise: pl.lineTotalPaise,
                };
              }),
            },
            statusHistory: {
              create: {
                toStatus: "PENDING",
                actorType: ctx.userId ? "CUSTOMER" : "SYSTEM",
                actorId: ctx.userId,
                note: "Order placed",
              },
            },
          },
        });

        // Reserve stock (atomic conditional update on available stock — aborts the whole transaction
        // if any line is short). Unpaid online orders hold it only until the payment window lapses.
        for (const pl of p.lines) {
          await reserveStock(tx, {
            orderId: order.id,
            variantId: pl.key,
            quantity: pl.quantity,
            expiresAt: order.paymentExpiresAt,
          });
        }

        // Coupon: global usage limit enforced with a conditional increment.
        if (p.couponCode) {
          const coupon = await tx.coupon.findUniqueOrThrow({ where: { code: p.couponCode } });
          const inc = await tx.$executeRaw`
            UPDATE "Coupon" SET "usedCount" = "usedCount" + 1
            WHERE id = ${coupon.id} AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
          if (inc === 0)
            throw new AppError("COUPON_INVALID", "This coupon has just reached its usage limit");
          await tx.couponUsage.create({
            data: {
              couponId: coupon.id,
              orderId: order.id,
              userId: ctx.userId,
              email: input.email,
              discountPaise: p.couponDiscountPaise,
            },
          });
        }

        if (isCod) {
          await tx.payment.create({
            data: {
              orderId: order.id,
              method: "COD",
              status: "CREATED",
              amountPaise: p.totalPaise,
            },
          });
          await transitionOrder(tx, {
            orderId: order.id,
            to: "CONFIRMED",
            actor: { type: "SYSTEM" },
            note: "Cash on Delivery order confirmed",
          });
        }

        // Empty the cart (a "Buy now" order never touches it: view.id is null).
        if (view.id && !input.buyNow) {
          await tx.cartItem.deleteMany({ where: { cartId: view.id } });
          await tx.cart.update({ where: { id: view.id }, data: { couponCode: null } });
        }

        if (input.saveAddress && ctx.userId) {
          const count = await tx.address.count({ where: { userId: ctx.userId } });
          const duplicate = await tx.address.findFirst({
            where: {
              userId: ctx.userId,
              line1: shipping.line1,
              pincode: shipping.pincode,
              fullName: shipping.fullName,
            },
          });
          if (!duplicate && count < 20) {
            await tx.address.create({
              data: { ...shipping, userId: ctx.userId, isDefault: count === 0 },
            });
          }
        }

        return {
          id: order.id,
          orderNumber,
          status: isCod ? "CONFIRMED" : "PENDING",
          totalPaise: p.totalPaise,
        };
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
  } catch (error) {
    // Concurrent duplicate submission with the same idempotency key.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await existingForKey(input.idempotencyKey, ctx, input.email);
      if (again) return again;
    }
    throw error;
  }

  logger.info("Order placed", {
    orderNumber: created.orderNumber,
    method: input.paymentMethod,
    total: created.totalPaise,
  });

  let payment: OnlinePaymentSession | null = null;
  if (input.paymentMethod === "RAZORPAY") {
    // Outside the DB transaction: network call. If it fails, the order stays PENDING and can be retried.
    payment = await startOnlinePayment(created.id).catch((error) => {
      logger.error("Could not start online payment", { orderNumber: created.orderNumber, error });
      return null;
    });
  }

  return {
    orderId: created.id,
    orderNumber: created.orderNumber,
    status: created.status,
    paymentMethod: input.paymentMethod,
    totalPaise: created.totalPaise,
    accessToken: orderAccessToken(created.id),
    payment,
    idempotentReplay: false,
  };
}
