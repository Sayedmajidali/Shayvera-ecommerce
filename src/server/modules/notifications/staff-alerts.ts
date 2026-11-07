import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/platform/db";
import { enqueue } from "@/server/platform/jobs/queue";
import { formatINR } from "@/lib/money";
import { siteConfig } from "@/lib/site";
import { stateName } from "@/lib/india";
import { escapeHtml, type EmailMessage } from "@/server/modules/notifications/email-service";
import { brandedEmail } from "@/server/modules/notifications/email-layout";
import { listLowStock } from "@/server/modules/inventory/inventory";

declare module "@/server/platform/jobs/queue" {
  interface JobPayloads {
    "notifications.low-stock-digest": Record<string, never>;
  }
}

/** Operational emails to the store's own team (Settings → alert emails). */
export const STAFF_ALERT_KINDS = [
  "new_order",
  "cancellation_requested",
  "return_requested",
  "refund_failed",
  "shipment_problem",
  "low_stock",
] as const;
export type StaffAlertKind = (typeof STAFF_ALERT_KINDS)[number];
export type StaffAlertPayload = {
  kind: StaffAlertKind;
  orderId: string | null;
  extra: string | null;
};

export function isStaffAlertPayload(v: Prisma.JsonValue): v is StaffAlertPayload {
  const o = v as Record<string, unknown> | null;
  return !!o && (STAFF_ALERT_KINDS as readonly string[]).includes(o.kind as string);
}

/**
 * Queues one alert per configured staff address inside the caller's transaction (outbox). The
 * dedupe key makes a re-processed event (webhook retry, job re-run) alert only once. With no
 * addresses configured nothing is queued.
 */
export async function queueStaffAlert(
  tx: Tx,
  p: { kind: StaffAlertKind; dedupeKey: string; orderId?: string | null; extra?: string | null },
) {
  const settings = await tx.storeSettings.findUnique({
    where: { id: "default" },
    select: { alertEmails: true },
  });
  const recipients = [...new Set(settings?.alertEmails ?? [])];
  let queued = 0;
  for (const recipient of recipients) {
    const dedupeKey = `staff-alert:${p.kind}:${p.dedupeKey}:${recipient}`;
    const exists = await tx.job.findUnique({ where: { dedupeKey }, select: { id: true } });
    if (exists) continue;
    const n = await tx.notification.create({
      data: {
        channel: "EMAIL",
        template: `staff-${p.kind}`,
        recipient,
        orderId: p.orderId ?? null,
        payload: { kind: p.kind, orderId: p.orderId ?? null, extra: p.extra ?? null },
      },
    });
    await enqueue("notification.send", { notificationId: n.id }, { tx, dedupeKey });
    queued++;
  }
  return queued;
}

const SUBJECT: Record<StaffAlertKind, string> = {
  new_order: "New order",
  cancellation_requested: "Cancellation requested",
  return_requested: "Return requested",
  refund_failed: "Refund failed",
  shipment_problem: "Shipment needs attention",
  low_stock: "Low stock",
};

const INTRO: Record<StaffAlertKind, string> = {
  new_order: "A new order is confirmed and ready to pack.",
  cancellation_requested:
    "A customer asked to cancel this order. Stock stays reserved until you decide.",
  return_requested: "A customer asked to return items from this order.",
  refund_failed:
    "A refund could not be completed. The amount was released — retry or refund manually.",
  shipment_problem: "The courier booking or tracking for this order needs a look.",
  low_stock: "These products are at or below their low-stock threshold.",
};

/**
 * Renders a staff alert at delivery time from current data. Contains order number, value, items and
 * destination city only — no customer phone, email or full address.
 */
export async function renderStaffAlert(
  recipient: string,
  p: StaffAlertPayload,
): Promise<EmailMessage | null> {
  const admin = `${siteConfig.url}/admin`;
  if (p.kind === "low_stock") {
    const rows = await listLowStock(30);
    if (rows.length === 0) return null; // restocked since: nothing to say
    const lines = rows.map(
      (r) => `${r.productName} (${r.variantName}, ${r.sku}): ${r.available} available`,
    );
    const body = await brandedEmail({
      text: [
        INTRO.low_stock,
        "",
        ...lines.map((l) => `• ${l}`),
        "",
        `Inventory: ${admin}/inventory`,
      ].join("\n"),
      bodyHtml: `<p>${INTRO.low_stock}</p><ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul><p><a href="${admin}/inventory">Open inventory</a></p>`,
      footerNote: "Staff alert — change recipients in Admin → Settings.",
    });
    return {
      to: recipient,
      subject: `${SUBJECT.low_stock}: ${rows.length} item(s)`,
      template: "staff-low_stock",
      ...body,
    };
  }
  if (!p.orderId) return null;
  const order = await db.order.findUnique({ where: { id: p.orderId }, include: { items: true } });
  if (!order) return null;
  const a = order.shippingAddress as { city?: string };
  const where = [a.city, stateName(order.shippingStateCode)].filter(Boolean).join(", ");
  const lines = order.items.map((i) => `${i.productName} (${i.variantName}) × ${i.quantity}`);
  const url = `${admin}/orders/${order.id}`;
  const summary = `${order.orderNumber} · ${formatINR(order.totalPaise)} · ${order.paymentMethod === "COD" ? "COD" : "Paid online"} · ${where}`;
  const body = await brandedEmail({
    text: [
      INTRO[p.kind],
      ...(p.extra ? [p.extra] : []),
      "",
      summary,
      ...lines.map((l) => `• ${l}`),
      "",
      `Open: ${url}`,
    ].join("\n"),
    bodyHtml: `<p>${escapeHtml(INTRO[p.kind])}</p>${p.extra ? `<p><strong>${escapeHtml(p.extra)}</strong></p>` : ""}<p>${escapeHtml(summary)}</p><ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul><p><a href="${escapeHtml(url)}">Open the order</a></p>`,
    footerNote: "Staff alert — change recipients in Admin → Settings.",
  });
  return {
    to: recipient,
    subject: `${SUBJECT[p.kind]}: ${order.orderNumber}`,
    template: `staff-${p.kind}`,
    ...body,
  };
}

/** Daily job: one low-stock email per India day when anything is low (dedupe by date). */
export async function queueLowStockDigest(now = new Date()) {
  const rows = await listLowStock(1);
  if (rows.length === 0) return 0;
  const day = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  return db.$transaction((tx) => queueStaffAlert(tx, { kind: "low_stock", dedupeKey: day }));
}
