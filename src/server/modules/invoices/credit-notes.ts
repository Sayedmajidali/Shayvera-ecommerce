import type { Tx } from "@/server/platform/db";
import { db } from "@/server/platform/db";
import { divRound } from "@/lib/money";
import { financialYear, nextSequence } from "@/server/platform/sequence";
import type { InvoiceSnapshot } from "@/server/modules/invoices/invoices";

export type CreditNoteSnapshot = {
  documentTitle: "Credit Note";
  number: string;
  issuedAt: string;
  invoiceNumber: string;
  invoiceDate: string;
  orderNumber: string;
  seller: InvoiceSnapshot["seller"];
  buyer: {
    name: string;
    email: string;
    phone: string;
    billingAddress: InvoiceSnapshot["buyer"]["billingAddress"];
  };
  placeOfSupply: InvoiceSnapshot["placeOfSupply"];
  supplyType: InvoiceSnapshot["supplyType"];
  gstApplicable: boolean;
  reason: string;
  refundMethod: "Razorpay" | "Manual";
  /** Returned items, when the refund settles a return request. */
  items: { description: string; quantity: number }[];
  totals: {
    taxableValuePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    taxPaise: number;
    totalPaise: number;
  };
  notes: string[];
};

/**
 * Splits a refunded amount (tax-inclusive) in the same proportions as the original invoice: each tax
 * head is pro-rated with half-up rounding and the taxable value takes the remainder, so the parts
 * always add up to the refund exactly.
 */
export function creditNoteTotals(inv: InvoiceSnapshot["totals"], amountPaise: number) {
  const share = (v: number) =>
    inv.grandTotalPaise > 0 ? divRound(v * amountPaise, inv.grandTotalPaise) : 0;
  const cgstPaise = share(inv.cgstPaise);
  const sgstPaise = share(inv.sgstPaise);
  const igstPaise = share(inv.igstPaise);
  const taxPaise = cgstPaise + sgstPaise + igstPaise;
  return {
    taxableValuePaise: amountPaise - taxPaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    taxPaise,
    totalPaise: amountPaise,
  };
}

/**
 * Issues the credit note for a processed refund of an invoiced order, inside the transaction that
 * settles the refund. Idempotent (one per refund); does nothing when the order has no invoice —
 * an invoice issued later already reflects the refunded state of the order.
 */
export async function issueCreditNoteForRefund(tx: Tx, refundId: string) {
  const refund = await tx.refund.findUnique({
    where: { id: refundId },
    include: {
      creditNote: { select: { id: true } },
      order: { include: { invoice: true, items: true } },
      request: { select: { receipt: true, lines: true } },
    },
  });
  if (!refund || refund.status !== "PROCESSED" || refund.creditNote || !refund.order.invoice)
    return null;
  const inv = refund.order.invoice;
  const s = inv.snapshot as unknown as InvoiceSnapshot;
  const settings = await tx.storeSettings.findUnique({
    where: { id: "default" },
    select: { creditNotePrefix: true },
  });
  const now = new Date();
  const fy = financialYear(now);
  const seq = await nextSequence(tx, `credit-note:${fy}`);
  const fyShort = fy.replace(/^20(\d\d)-(\d\d)$/, "$1$2");
  const number = `${settings?.creditNotePrefix ?? "CN"}${fyShort}/${String(seq).padStart(5, "0")}`;
  const received =
    (refund.request?.receipt as { orderItemId: string; receivedQuantity: number }[] | null) ?? [];
  const items = received
    .filter((r) => r.receivedQuantity > 0)
    .map((r) => {
      const i = refund.order.items.find((x) => x.id === r.orderItemId);
      return {
        description: i ? `${i.productName} (${i.variantName})` : "Item",
        quantity: r.receivedQuantity,
      };
    });
  const snapshot: CreditNoteSnapshot = {
    documentTitle: "Credit Note",
    number,
    issuedAt: now.toISOString(),
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.issuedAt.toISOString(),
    orderNumber: refund.order.orderNumber,
    seller: s.seller,
    buyer: {
      name: s.buyer.name,
      email: s.buyer.email,
      phone: s.buyer.phone,
      billingAddress: s.buyer.billingAddress,
    },
    placeOfSupply: s.placeOfSupply,
    supplyType: s.supplyType,
    gstApplicable: s.gstApplicable,
    reason: refund.reason.slice(0, 200),
    refundMethod: refund.method === "RAZORPAY" ? "Razorpay" : "Manual",
    items,
    totals: creditNoteTotals(s.totals, refund.amountPaise),
    notes: [
      `Issued against invoice ${inv.invoiceNumber} for an amount refunded to the customer.`,
      ...(s.gstApplicable ? [] : ["Seller is not registered under GST; no tax is reversed."]),
      "This is a computer-generated credit note.",
    ],
  };
  return tx.creditNote.create({
    data: {
      number,
      financialYear: fy,
      invoiceId: inv.id,
      orderId: refund.orderId,
      refundId: refund.id,
      snapshot,
      amountPaise: refund.amountPaise,
      issuedAt: now,
    },
  });
}

/** Credit notes for an order (customer and admin views). */
export function listCreditNotes(orderId: string) {
  return db.creditNote.findMany({
    where: { orderId },
    orderBy: { issuedAt: "asc" },
    select: { id: true, number: true, issuedAt: true, amountPaise: true, refundId: true },
  });
}
