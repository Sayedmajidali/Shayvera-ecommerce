import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { formatINR } from "@/lib/money";
import { siteConfig } from "@/lib/site";
import { escapeHtml, sendEmail } from "@/server/email/email-service";
import { orderAccessToken } from "@/server/services/order-access";

function orderUrl(order: { id: string; orderNumber: string; userId: string | null }) {
  return order.userId
    ? `${siteConfig.url}/account/orders/${order.orderNumber}`
    : `${siteConfig.url}/order/${order.orderNumber}?t=${orderAccessToken(order.id)}`;
}

async function load(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    include: { items: true, shipments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
}

type Kind = "confirmed" | "cancelled" | "shipped" | "delivered" | "refunded";

const SUBJECT: Record<Kind, (n: string) => string> = {
  confirmed: (n) => `Order ${n} confirmed`,
  cancelled: (n) => `Order ${n} cancelled`,
  shipped: (n) => `Order ${n} is on its way`,
  delivered: (n) => `Order ${n} delivered`,
  refunded: (n) => `Refund issued for order ${n}`,
};

/** Fire-and-forget transactional email; never throws into the business flow. */
export async function sendOrderEmail(orderId: string, kind: Kind, extra?: string) {
  try {
    const order = await load(orderId);
    if (!order) return;
    const lines = order.items.map(
      (i) =>
        `• ${i.productName} (${i.variantName}) × ${i.quantity} — ${formatINR(i.lineTotalPaise)}`,
    );
    const shipment = order.shipments[0];
    const intro: Record<Kind, string> = {
      confirmed: `Thank you for your order! ${order.paymentMethod === "COD" ? "Please keep the exact amount ready for Cash on Delivery." : "We’ve received your payment."}`,
      cancelled: `Your order has been cancelled.${order.cancelReason ? ` Reason: ${order.cancelReason}.` : ""}`,
      shipped: `Good news — your order has shipped${shipment ? ` via ${shipment.carrier}${shipment.trackingNumber ? ` (tracking ${shipment.trackingNumber})` : ""}` : ""}.`,
      delivered: "Your order has been delivered. We hope you love it!",
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
    await sendEmail({
      to: order.email,
      subject: SUBJECT[kind](order.orderNumber),
      template: `order-${kind}`,
      text,
      html: `<p>${escapeHtml(intro[kind])}</p><p><strong>Order ${escapeHtml(order.orderNumber)}</strong></p><ul>${order.items
        .map(
          (i) =>
            `<li>${escapeHtml(i.productName)} (${escapeHtml(i.variantName)}) × ${i.quantity} — ${formatINR(i.lineTotalPaise)}</li>`,
        )
        .join(
          "",
        )}</ul><p>Total: <strong>${formatINR(order.totalPaise)}</strong></p><p><a href="${escapeHtml(url)}">View your order</a></p>`,
    });
  } catch (error) {
    logger.error("Failed to send order email", { orderId, kind, error });
  }
}
