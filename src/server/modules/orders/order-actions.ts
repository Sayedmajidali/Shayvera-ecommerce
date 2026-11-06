import { db } from "@/server/platform/db";
import { AppError } from "@/lib/errors";
import { verifyOrderAccessToken } from "@/server/modules/orders/order-access";
import { CUSTOMER_CANCELLABLE } from "@/server/modules/orders/order-status";
import { orderDetailInclude, transitionOrder } from "@/server/modules/orders/orders";
import { createRefund } from "@/server/modules/payments/payments";

/** Order visible to the requester: the signed-in owner, or a guest holding the access token. */
export async function resolveOrderForRequester(
  orderNumber: string,
  who: { userId: string | null; token: string | null },
) {
  const order = await db.order.findUnique({ where: { orderNumber }, include: orderDetailInclude });
  if (!order) throw new AppError("NOT_FOUND", "Order not found");
  const owner = who.userId !== null && order.userId === who.userId;
  const tokenOk = verifyOrderAccessToken(order.id, who.token);
  if (!owner && !tokenOk) throw new AppError("NOT_FOUND", "Order not found");
  return order;
}

export async function cancelOrderAsCustomer(
  orderNumber: string,
  who: { userId: string | null; token: string | null },
  reason?: string | null,
) {
  const order = await resolveOrderForRequester(orderNumber, who);
  if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
    throw new AppError(
      "INVALID_STATE",
      "This order can no longer be cancelled online. Please contact support.",
    );
  }
  await db.$transaction((tx) =>
    transitionOrder(tx, {
      orderId: order.id,
      to: "CANCELLED",
      actor: { type: "CUSTOMER", id: who.userId },
      note: reason ? `Cancelled by customer: ${reason}` : "Cancelled by customer",
    }),
  );
  const fresh = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  if (fresh.paymentStatus === "PAID" && fresh.paymentMethod === "RAZORPAY") {
    await createRefund({
      orderId: order.id,
      amountPaise: fresh.totalPaise - fresh.refundedPaise,
      reason: "Order cancelled by customer",
      actor: { type: "CUSTOMER", id: who.userId },
    });
  }
  return db.order.findUniqueOrThrow({ where: { id: order.id } });
}
