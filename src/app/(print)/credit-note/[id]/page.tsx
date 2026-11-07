import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/shared/print-button";
import { db } from "@/server/platform/db";
import { stateName } from "@/lib/india";
import { formatINRExact } from "@/lib/money";
import { firstValues } from "@/lib/search-params";
import type { AddressSnapshot } from "@/lib/validation/checkout";
import { getCurrentUser } from "@/server/modules/auth/session";
import type { CreditNoteSnapshot } from "@/server/modules/invoices/credit-notes";
import { verifyOrderAccessToken } from "@/server/modules/orders/order-access";

export const metadata: Metadata = { title: "Credit note", robots: { index: false, follow: false } };

function addr(a: AddressSnapshot) {
  return `${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.city}, ${stateName(a.stateCode)} ${a.pincode}`;
}

const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

/** Printable credit note. Same access as the invoice: admins, the order owner, or the guest token. */
export default async function CreditNotePage({
  params,
  searchParams,
}: PageProps<"/credit-note/[id]">) {
  const { id } = await params;
  const sp = firstValues(await searchParams);
  const [user, note] = await Promise.all([
    getCurrentUser(),
    db.creditNote.findUnique({
      where: { id },
      include: { order: { select: { id: true, userId: true } } },
    }),
  ]);
  if (!note) notFound();
  const allowed =
    user?.role === "ADMIN" ||
    (user && note.order.userId === user.id) ||
    verifyOrderAccessToken(note.order.id, sp.t);
  if (!allowed) notFound();
  const cn = note.snapshot as unknown as CreditNoteSnapshot;
  const intra = cn.supplyType === "INTRA_STATE";
  const row = "flex justify-between";

  return (
    <div className="mx-auto max-w-4xl px-4">
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <article className="shadow-soft rounded-xl border bg-white p-8 text-[13px] text-neutral-900 print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b pb-6">
          <div>
            <p className="heading-display text-2xl">{cn.seller.name}</p>
            {cn.seller.legalName && <p>{cn.seller.legalName}</p>}
            <p className="max-w-xs text-neutral-600">{cn.seller.address}</p>
            <p className="text-neutral-600">
              {cn.seller.email}
              {cn.seller.phone ? ` · ${cn.seller.phone}` : ""}
            </p>
            {cn.seller.gstin && <p className="mt-1 font-medium">GSTIN: {cn.seller.gstin}</p>}
          </div>
          <div className="text-right">
            <h1 className="text-xl font-semibold tracking-wide uppercase">{cn.documentTitle}</h1>
            <p>
              Credit note no.{" "}
              <span className="font-medium" data-testid="credit-note-number">
                {cn.number}
              </span>
            </p>
            <p>Date: {date(cn.issuedAt)}</p>
            <p>
              Against invoice {cn.invoiceNumber} ({date(cn.invoiceDate)})
            </p>
            <p>Order: {cn.orderNumber}</p>
          </div>
        </header>
        <section className="grid gap-6 border-b py-6 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold text-neutral-500 uppercase">Customer</p>
            <p className="font-medium">{cn.buyer.billingAddress.fullName}</p>
            <p className="text-neutral-600">{addr(cn.buyer.billingAddress)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-neutral-500 uppercase">Place of supply</p>
            <p>
              {cn.placeOfSupply.stateName} ({cn.placeOfSupply.stateCode})
            </p>
            <p className="mt-2 text-[11px] font-semibold text-neutral-500 uppercase">Reason</p>
            <p>{cn.reason}</p>
            <p className="text-neutral-600">Refunded via {cn.refundMethod}</p>
          </div>
        </section>
        {cn.items.length > 0 && (
          <section className="border-b py-4">
            <p className="text-[11px] font-semibold text-neutral-500 uppercase">Returned items</p>
            <ul className="mt-1 list-inside list-disc">
              {cn.items.map((i) => (
                <li key={i.description}>
                  {i.description} × {i.quantity}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="mt-6 flex justify-end">
          <dl className="grid w-72 gap-1.5 tabular-nums">
            <div className={row}>
              <dt>Taxable value</dt>
              <dd>{formatINRExact(cn.totals.taxableValuePaise)}</dd>
            </div>
            {cn.gstApplicable &&
              (intra ? (
                <>
                  <div className={row}>
                    <dt>CGST</dt>
                    <dd>{formatINRExact(cn.totals.cgstPaise)}</dd>
                  </div>
                  <div className={row}>
                    <dt>SGST</dt>
                    <dd>{formatINRExact(cn.totals.sgstPaise)}</dd>
                  </div>
                </>
              ) : (
                <div className={row}>
                  <dt>IGST</dt>
                  <dd>{formatINRExact(cn.totals.igstPaise)}</dd>
                </div>
              ))}
            <div className={`${row} border-t pt-2 text-base font-semibold`}>
              <dt>Total credited</dt>
              <dd>{formatINRExact(cn.totals.totalPaise)}</dd>
            </div>
          </dl>
        </div>
        <footer className="mt-8 border-t pt-4 text-[11px] text-neutral-500">
          {cn.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </footer>
      </article>
    </div>
  );
}
