import { db } from "@/server/platform/db";
import { formatINR } from "@/lib/money";
import { siteConfig } from "@/lib/site";
import { escapeHtml, type EmailMessage } from "@/server/modules/notifications/email-service";
import { orderAccessToken } from "@/server/modules/orders/order-access";
import {
  brandedEmail,
  EMAIL_COLORS,
  emailButton,
  emailPanel,
  emailSectionTitle,
} from "@/server/modules/notifications/email-layout";
import { stateName } from "@/lib/india";

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
      invoice: { select: { invoiceNumber: true } },
      shipments: {
        where: { isReturn: false, status: { notIn: ["CANCELLED", "FAILED"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!order) return null;
  const shipment = order.shipments[0];
  const address = order.shippingAddress as {
    fullName?: string;
    phone?: string;
    line1?: string;
    line2?: string | null;
    landmark?: string | null;
    city?: string;
    stateCode?: string;
    pincode?: string;
  };
  const firstName = (address.fullName ?? "").trim().split(/\s+/)[0] || "there";
  const cod = order.paymentMethod === "COD";
  const intro: Record<OrderEmailKind, string> = {
    confirmed: `Thank you for shopping with Shayvera! We’ve received your order and are getting it ready. ${cod ? "Please keep the exact amount ready for Cash on Delivery." : "We’ve received your payment."}`,
    cancelled: `Your order has been cancelled.${order.cancelReason ? ` Reason: ${order.cancelReason}.` : ""}`,
    shipped: `Good news — your order has shipped${shipment ? ` via ${shipment.carrier}` : ""}.`,
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
  const headline: Record<OrderEmailKind, string> = {
    confirmed: "Your order is confirmed",
    cancelled: "Your order was cancelled",
    shipped: "Your order is on its way",
    out_for_delivery: "Out for delivery today",
    delivered: "Your order has arrived",
    cancellation_requested: "Cancellation request received",
    return_requested: "Return request received",
    return_approved: "Your return is approved",
    request_rejected: "An update on your request",
    returned: "We received your return",
    refunded: "Your refund is on its way",
  };

  // Expected delivery (courier estimate captured at checkout) — confirmation email only.
  const eta =
    kind === "confirmed" &&
    order.deliveryEtaDays &&
    order.placedAt.getTime() + order.deliveryEtaDays * 86_400_000 > Date.now()
      ? new Date(order.placedAt.getTime() + order.deliveryEtaDays * 86_400_000).toLocaleDateString(
          "en-IN",
          { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" },
        )
      : null;
  const tracking =
    shipment?.trackingNumber && (kind === "shipped" || kind === "out_for_delivery")
      ? `${shipment.carrier} · AWB ${shipment.trackingNumber}`
      : null;

  const url = orderUrl(order);
  const invoiceUrl = order.invoice
    ? `${siteConfig.url}/invoice/${order.orderNumber}${order.userId ? "" : `?t=${orderAccessToken(order.id)}`}`
    : null;
  const showInvoice =
    invoiceUrl && (kind === "delivered" || kind === "refunded" || kind === "returned");
  const showSummary = !["request_rejected", "cancellation_requested"].includes(kind);

  // Price breakdown, mirroring the order summary on the site.
  const rows: { label: string; value: string; strong?: boolean; tone?: string }[] = [
    { label: "Subtotal", value: formatINR(order.subtotalPaise) },
  ];
  if (order.couponDiscountPaise > 0)
    rows.push({
      label: `Coupon${order.couponCode ? ` (${order.couponCode})` : ""}`,
      value: `−${formatINR(order.couponDiscountPaise)}`,
      tone: EMAIL_COLORS.green,
    });
  rows.push({
    label: "Shipping",
    value: order.shippingPaise > 0 ? formatINR(order.shippingPaise) : "Free",
  });
  if (order.codFeePaise > 0)
    rows.push({ label: "Cash on Delivery fee", value: formatINR(order.codFeePaise) });
  if (order.taxPaise > 0 && !order.pricesIncludeTax)
    rows.push({ label: "GST", value: formatINR(order.taxPaise) });
  rows.push({
    label: cod ? "To pay on delivery" : "Total paid",
    value: formatINR(order.totalPaise),
    strong: true,
  });
  const gstNote =
    order.taxPaise > 0 && order.pricesIncludeTax
      ? `Includes GST of ${formatINR(order.taxPaise)}`
      : null;

  const addressLines = [
    address.fullName,
    [address.line1, address.line2].filter(Boolean).join(", "),
    address.landmark ? `Near ${address.landmark}` : null,
    [address.city, address.stateCode ? stateName(address.stateCode) : null, address.pincode]
      .filter(Boolean)
      .join(", "),
    address.phone ? `Phone: ${address.phone}` : null,
  ].filter((l): l is string => !!l);

  // ── Plain-text version ──
  const text = [
    `Hi ${firstName},`,
    "",
    intro[kind],
    ...(eta ? ["", `Expected delivery: by ${eta} (courier estimate)`] : []),
    ...(tracking ? ["", `Tracking: ${tracking}`] : []),
    "",
    `Order ${order.orderNumber}`,
    ...order.items.map(
      (i) =>
        `• ${i.productName} (${i.variantName}) × ${i.quantity} — ${formatINR(i.lineTotalPaise)}`,
    ),
    ...(showSummary
      ? ["", ...rows.map((r) => `${r.label}: ${r.value}`), ...(gstNote ? [gstNote] : [])]
      : []),
    ...(showSummary && addressLines.length ? ["", "Delivering to:", ...addressLines] : []),
    "",
    `View your order: ${url}`,
    ...(showInvoice ? [`Invoice ${order.invoice!.invoiceNumber}: ${invoiceUrl}`] : []),
  ].join("\n");

  // ── HTML version ──
  const cell = `font-size:14px;padding:10px 0;border-bottom:1px solid ${EMAIL_COLORS.line}`;
  const itemRows = order.items
    .map(
      (i) => `<tr>
<td style="${cell}"><strong>${escapeHtml(i.productName)}</strong><br><span style="color:${EMAIL_COLORS.muted};font-size:13px">${escapeHtml(i.variantName)} × ${i.quantity}</span></td>
<td align="right" style="${cell};white-space:nowrap;vertical-align:top">${formatINR(i.lineTotalPaise)}</td></tr>`,
    )
    .join("");
  const summaryRows = rows
    .map(
      (r) => `<tr>
<td style="font-size:14px;padding:4px 0;${r.strong ? `font-weight:700;font-size:16px;padding-top:10px;border-top:1px solid ${EMAIL_COLORS.line}` : `color:${EMAIL_COLORS.muted}`}">${escapeHtml(r.label)}</td>
<td align="right" style="font-size:14px;padding:4px 0;white-space:nowrap;${r.strong ? `font-weight:700;font-size:16px;padding-top:10px;border-top:1px solid ${EMAIL_COLORS.line}` : ""}${r.tone ? `;color:${r.tone}` : ""}">${escapeHtml(r.value)}</td></tr>`,
    )
    .join("");
  const highlight = eta
    ? emailPanel(
        `<strong>Expected delivery: by ${escapeHtml(eta)}</strong><br><span style="color:${EMAIL_COLORS.muted}">Courier estimate — we’ll email you the tracking details as soon as it ships.</span>`,
      )
    : kind === "confirmed"
      ? emailPanel("We’ll email you the tracking details as soon as your order ships.")
      : tracking
        ? emailPanel(
            `<strong>Tracking</strong><br>${escapeHtml(tracking)}<br><span style="color:${EMAIL_COLORS.muted}">Use the button below to follow your parcel.</span>`,
          )
        : "";

  const bodyHtml = `
<h1 style="margin:8px 0 6px;font-size:24px;line-height:1.25;color:${EMAIL_COLORS.ink};font-weight:700">${escapeHtml(headline[kind])}</h1>
<p style="margin:0 0 4px;color:${EMAIL_COLORS.muted};font-size:13px">Order <strong style="color:${EMAIL_COLORS.ink}">${escapeHtml(order.orderNumber)}</strong> · ${escapeHtml(order.placedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }))}</p>
<p style="margin:18px 0 0">Hi ${escapeHtml(firstName)},</p>
<p style="margin:8px 0 0">${escapeHtml(intro[kind])}</p>
${highlight}
${emailSectionTitle("Your items")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${itemRows}</table>
${
  showSummary
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px">${summaryRows}</table>${
        gstNote
          ? `<p style="margin:6px 0 0;font-size:12px;color:${EMAIL_COLORS.muted}">${escapeHtml(gstNote)}</p>`
          : ""
      }
<p style="margin:10px 0 0;font-size:13px;color:${EMAIL_COLORS.muted}">Payment: <strong style="color:${EMAIL_COLORS.ink}">${cod ? "Cash on Delivery" : "Paid online"}</strong></p>`
    : ""
}
${
  showSummary && addressLines.length
    ? `${emailSectionTitle("Delivering to")}<p style="margin:0;font-size:14px;line-height:1.55">${addressLines.map((l) => escapeHtml(l)).join("<br>")}</p>`
    : ""
}
<div style="margin-top:26px">${emailButton(url, kind === "shipped" || kind === "out_for_delivery" ? "Track your order" : "View your order")}</div>
${
  showInvoice
    ? `<p style="margin:12px 0 0;font-size:14px"><a href="${escapeHtml(invoiceUrl!)}" target="_blank" style="color:${EMAIL_COLORS.green}">Download invoice ${escapeHtml(order.invoice!.invoiceNumber)}</a></p>`
    : ""
}
<p style="margin:26px 0 0;font-size:13px;color:${EMAIL_COLORS.muted}">Questions about your order? Just reply to this email — we’re happy to help.</p>`;

  const branded = await brandedEmail({
    text,
    bodyHtml,
    preheader: eta
      ? `${headline[kind]} — expected by ${eta}. Order ${order.orderNumber}, ${formatINR(order.totalPaise)}.`
      : `${headline[kind]} — order ${order.orderNumber}, ${formatINR(order.totalPaise)}.`,
  });
  return {
    to: order.email,
    subject: SUBJECT[kind](order.orderNumber),
    template: `order-${kind}`,
    ...branded,
  };
}
