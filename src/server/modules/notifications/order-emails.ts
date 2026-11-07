import { db } from "@/server/platform/db";
import { formatINR } from "@/lib/money";
import { siteConfig } from "@/lib/site";
import { escapeHtml, type EmailMessage } from "@/server/modules/notifications/email-service";
import { orderAccessToken } from "@/server/modules/orders/order-access";

export const ORDER_EMAIL_KINDS = [
  "confirmed",
  "cancelled",
  "shipped",
  "out_for_delivery",
  "delivered",
  "refunded",
  "cancellation_requested",
  "return_requested",
  "return_approved",
  "request_rejected",
  "returned",
] as const;
export type OrderEmailKind = (typeof ORDER_EMAIL_KINDS)[number];

function orderUrl(order: { id: string; orderNumber: string; userId: string | null }) {
  return order.userId
    ? `${siteConfig.url}/account/orders/${order.orderNumber}`
    : `${siteConfig.url}/order/${order.orderNumber}?t=${orderAccessToken(order.id)}`;
}

const SUBJECT: Record<OrderEmailKind, (n: string) => string> = {
  confirmed: (n) => `Order ${n} confirmed`,
  cancelled: (n) => `Order ${n} cancelled`,
  shipped: (n) => `Order ${n} is on its way`,
  out_for_delivery: (n) => `Order ${n} is out for delivery`,
  delivered: (n) => `Order ${n} delivered`,
  refunded: (n) => `Refund issued for order ${n}`,
  cancellation_requested: (n) => `We received your cancellation request for ${n}`,
  return_requested: (n) => `We received your return request for ${n}`,
  return_approved: (n) => `Your return for ${n} is approved`,
  request_rejected: (n) => `Update on your request for order ${n}`,
  returned: (n) => `We received your return for ${n}`,
};

/**
 * Renders an order email from the order's current state. Rendering happens at delivery time so a
 * retried notification reflects the latest shipment/refund details. Returns null if the order is gone.
 */
export async function renderOrderEmail(
  orderId: string,
  kind: OrderEmailKind,
  extra?: string | null,
): Promise<EmailMessage | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      shipments: {
        where: { isReturn: false, status: { notIn: ["CANCELLED", "FAILED"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!order) return null;
  const lines = order.items.map(
    (i) => `• ${i.productName} (${i.variantName}) × ${i.quantity} — ${formatINR(i.lineTotalPaise)}`,
  );
  const shipment = order.shipments[0];
  const intro: Record<OrderEmailKind, string> = {
    confirmed: `Thank you for your order! ${order.paymentMethod === "COD" ? "Please keep the exact amount ready for Cash on Delivery." : "We’ve received your payment."}`,
    cancelled: `Your order has been cancelled.${order.cancelReason ? ` Reason: ${order.cancelReason}.` : ""}`,
    shipped: `Good news — your order has shipped${shipment ? ` via ${shipment.carrier}${shipment.trackingNumber ? ` (tracking ${shipment.trackingNumber})` : ""}` : ""}.`,
    out_for_delivery: "Your order is out for delivery today. Please keep your phone handy.",
    delivered: "Your order has been delivered. We hope you enjoy it!",
    cancellation_requested:
      "We’ve received your request to cancel this order. Our team will review it shortly and email you the outcome.",
    return_requested:
      "We’ve received your return request. Our team will review it and email you the next steps.",
    return_approved: `Your return has been approved.${extra ? ` ${extra}` : ""} We’ll confirm once we receive the items; any refund follows after inspection.`,
    request_rejected: `We couldn’t approve your request.${extra ? ` ${extra}` : ""} Reply to this email if you have questions.`,
    returned:
      "We’ve received your returned items. Any refund will be processed and confirmed by email.",
    refunded: `A refund has been issued${extra ? ` (${extra})` : ""}. It typically reaches your account in 5–7 business days.`,
  };
  const url = orderUrl(order);
  const text = [
    `Hi ${(order.shippingAddress as { fullName?: string }).fullName ?? "there"},`,
    "",
    intro[kind],
    "",
    `Order ${order.orderNumber}`,
    ...lines,
    `Total: ${formatINR(order.totalPaise)}`,
    "",
    `View your order: ${url}`,
  ].join("\n");
  const items = order.items
    .map(
      (i) =>
        `<li>${escapeHtml(i.productName)} (${escapeHtml(i.variantName)}) × ${i.quantity} — ${formatINR(i.lineTotalPaise)}</li>`,
    )
    .join("");
  return {
    to: order.email,
    subject: SUBJECT[kind](order.orderNumber),
    template: `order-${kind}`,
    text,
    html: `<p>${escapeHtml(intro[kind])}</p><p><strong>Order ${escapeHtml(order.orderNumber)}</strong></p><ul>${items}</ul><p>Total: <strong>${formatINR(order.totalPaise)}</strong></p><p><a href="${escapeHtml(url)}">View your order</a></p>`,
  };
}
