import { db } from "@/server/platform/db";
import { AppError } from "@/lib/errors";
import { stateName } from "@/lib/india";
import type { AddressSnapshot } from "@/lib/validation/checkout";
import { loadStoreSettings } from "@/server/modules/settings/queries";
import { audit } from "@/server/modules/audit/audit";
import { splitGst } from "@/server/modules/pricing/pricing";
import { financialYear, nextSequence } from "@/server/platform/sequence";
import { INVOICEABLE_STATUSES } from "@/server/modules/orders/order-status";

export type InvoiceLine = {
  description: string;
  sku: string;
  hsn: string | null;
  quantity: number;
  unitPricePaise: number;
  discountPaise: number;
  taxableValuePaise: number;
  taxRateBps: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
};

export type InvoiceSnapshot = {
  documentTitle: "Tax Invoice" | "Invoice";
  invoiceNumber: string;
  issuedAt: string;
  orderNumber: string;
  orderDate: string;
  seller: {
    fssaiLicense?: string | null;
    name: string;
    legalName: string | null;
    gstin: string | null;
    address: string;
    stateCode: string;
    stateName: string;
    email: string;
    phone: string | null;
  };
  buyer: {
    name: string;
    email: string;
    phone: string;
    billingAddress: AddressSnapshot;
    shippingAddress: AddressSnapshot;
  };
  placeOfSupply: { stateCode: string; stateName: string };
  supplyType: "INTRA_STATE" | "INTER_STATE";
  gstApplicable: boolean;
  pricesIncludeTax: boolean;
  paymentMethod: string;
  lines: InvoiceLine[];
  charges: { label: string; amountPaise: number; taxableValuePaise: number; taxPaise: number }[];
  totals: {
    taxableValuePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    taxPaise: number;
    couponDiscountPaise: number;
    grandTotalPaise: number;
  };
  notes: string[];
};

const INVOICEABLE = INVOICEABLE_STATUSES;

/**
 * Issues an invoice for an order (idempotent). Numbers are consecutive per Indian financial year,
 * ≤16 characters as required for GST invoices, e.g. "INV2627/00001". The content is frozen as a
 * JSON snapshot so later changes to settings or catalog never alter an issued invoice.
 */
export async function generateInvoice(
  orderId: string,
  actor: { id: string | null; ip?: string | null },
) {
  const existing = await db.invoice.findUnique({ where: { orderId } });
  if (existing) return existing;
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found");
  if (!(INVOICEABLE as readonly string[]).includes(order.status)) {
    throw new AppError("INVALID_STATE", "Invoices can be issued only for confirmed orders");
  }
  const settings = await loadStoreSettings();
  const gst = order.taxPaise > 0 || settings.gstEnabled;
  const intra = order.shippingStateCode === settings.stateCode;

  const lines: InvoiceLine[] = order.items.map((i) => {
    const base = i.lineSubtotalPaise - i.discountPaise;
    const taxable = order.pricesIncludeTax ? base - i.taxPaise : base;
    const split = splitGst(i.taxPaise, intra);
    return {
      description: `${i.productName}${i.variantName && i.variantName !== "Default" ? ` — ${i.variantName}` : ""}`,
      sku: i.sku,
      hsn: i.hsnCode,
      quantity: i.quantity,
      unitPricePaise: i.unitPricePaise,
      discountPaise: i.discountPaise,
      taxableValuePaise: taxable,
      taxRateBps: i.taxRateBps,
      cgstPaise: split.cgst,
      sgstPaise: split.sgst,
      igstPaise: split.igst,
      totalPaise: taxable + i.taxPaise,
    };
  });
  const lineTax = order.items.reduce((s, i) => s + i.taxPaise, 0);
  const chargesTax = order.taxPaise - lineTax;
  const chargesTotal = order.shippingPaise + order.codFeePaise;
  // Shipping and COD fee share the charges' GST pro-rata (largest part to shipping by rounding).
  const shippingTax =
    chargesTotal > 0 ? Math.round((chargesTax * order.shippingPaise) / chargesTotal) : 0;
  const charges: InvoiceSnapshot["charges"] = (
    [
      ["Shipping", order.shippingPaise, shippingTax],
      ["Cash on Delivery fee", order.codFeePaise, chargesTax - shippingTax],
    ] as const
  )
    .filter(([, amount]) => amount > 0)
    .map(([label, amount, tax]) => ({
      label,
      amountPaise: amount,
      taxableValuePaise: order.pricesIncludeTax ? amount - tax : amount,
      taxPaise: tax,
    }));
  const taxable =
    lines.reduce((s, l) => s + l.taxableValuePaise, 0) +
    charges.reduce((s, c) => s + c.taxableValuePaise, 0);
  const billing = order.billingAddress as AddressSnapshot;
  const shipping = order.shippingAddress as AddressSnapshot;
  const sellerAddress = [
    settings.addressLine1,
    settings.addressLine2,
    settings.city,
    `${stateName(settings.stateCode)} ${settings.pincode ?? ""}`.trim(),
  ]
    .filter(Boolean)
    .join(", ");

  return db.$transaction(async (tx) => {
    const again = await tx.invoice.findUnique({ where: { orderId } });
    if (again) return again;
    const now = new Date();
    const fy = financialYear(now);
    const seq = await nextSequence(tx, `invoice:${fy}`);
    const fyShort = fy.replace(/^20(\d\d)-(\d\d)$/, "$1$2");
    const invoiceNumber = `${settings.invoicePrefix}${fyShort}/${String(seq).padStart(5, "0")}`;
    const snapshot: InvoiceSnapshot = {
      documentTitle: gst && settings.gstin ? "Tax Invoice" : "Invoice",
      invoiceNumber,
      issuedAt: now.toISOString(),
      orderNumber: order.orderNumber,
      orderDate: order.placedAt.toISOString(),
      seller: {
        name: settings.storeName,
        legalName: settings.legalName,
        gstin: gst ? settings.gstin : null,
        fssaiLicense: settings.fssaiLicense,
        address: sellerAddress,
        stateCode: settings.stateCode,
        stateName: stateName(settings.stateCode),
        email: settings.supportEmail,
        phone: settings.supportPhone,
      },
      buyer: {
        name: billing.fullName,
        email: order.email,
        phone: order.phone,
        billingAddress: billing,
        shippingAddress: shipping,
      },
      placeOfSupply: {
        stateCode: order.shippingStateCode,
        stateName: stateName(order.shippingStateCode),
      },
      supplyType: intra ? "INTRA_STATE" : "INTER_STATE",
      gstApplicable: gst,
      pricesIncludeTax: order.pricesIncludeTax,
      paymentMethod: order.paymentMethod === "COD" ? "Cash on Delivery" : "Online (Razorpay)",
      lines,
      charges,
      totals: {
        taxableValuePaise: taxable,
        cgstPaise: order.cgstPaise,
        sgstPaise: order.sgstPaise,
        igstPaise: order.igstPaise,
        taxPaise: order.taxPaise,
        couponDiscountPaise: order.couponDiscountPaise,
        grandTotalPaise: order.totalPaise,
      },
      notes: [
        ...(gst ? [] : ["Seller is not registered under GST; no tax has been charged."]),
        ...(order.couponDiscountPaise > 0
          ? [`Includes coupon ${order.couponCode} discount, applied pro-rata to line values.`]
          : []),
        "This is a computer-generated invoice.",
      ],
    };
    const invoice = await tx.invoice.create({
      data: { orderId, invoiceNumber, financialYear: fy, snapshot, issuedAt: now },
    });
    if (actor.id)
      await audit(
        {
          actorId: actor.id,
          action: "invoice.issue",
          entityType: "Order",
          entityId: orderId,
          metadata: { invoiceNumber },
          ipAddress: actor.ip,
        },
        tx,
      );
    return invoice;
  });
}
