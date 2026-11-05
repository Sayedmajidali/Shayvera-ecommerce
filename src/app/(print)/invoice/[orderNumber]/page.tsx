import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/shared/print-button";
import { db } from "@/lib/db";
import { stateName } from "@/lib/india";
import { formatINRExact, percentFromBps } from "@/lib/money";
import { firstValues } from "@/lib/search-params";
import type { AddressSnapshot } from "@/lib/validation/checkout";
import { getCurrentUser } from "@/server/auth/session";
import type { InvoiceSnapshot } from "@/server/services/invoices";
import { verifyOrderAccessToken } from "@/server/services/order-access";

export const metadata: Metadata = { title: "Invoice", robots: { index: false, follow: false } };

function addr(a: AddressSnapshot) {
  return `${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.city}, ${stateName(a.stateCode)} ${a.pincode}`;
}

/** Printable invoice. Visible to admins, the order owner, or a guest with the order access token. */
export default async function InvoicePage({
  params,
  searchParams,
}: PageProps<"/invoice/[orderNumber]">) {
  const { orderNumber } = await params;
  const sp = firstValues(await searchParams);
  const [user, order] = await Promise.all([
    getCurrentUser(),
    db.order.findUnique({ where: { orderNumber }, include: { invoice: true } }),
  ]);
  if (!order?.invoice) notFound();
  const allowed =
    user?.role === "ADMIN" ||
    (user && order.userId === user.id) ||
    verifyOrderAccessToken(order.id, sp.t);
  if (!allowed) notFound();
  const inv = order.invoice.snapshot as unknown as InvoiceSnapshot;
  const intra = inv.supplyType === "INTRA_STATE";
  const th =
    "border-b px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
  const td = "border-b px-2 py-2 align-top";

  return (
    <div className="mx-auto max-w-4xl px-4">
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <article className="shadow-soft rounded-xl border bg-white p-8 text-[13px] text-neutral-900 print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b pb-6">
          <div>
            <p className="heading-display text-2xl">{inv.seller.name}</p>
            {inv.seller.legalName && <p>{inv.seller.legalName}</p>}
            <p className="max-w-xs text-neutral-600">{inv.seller.address}</p>
            <p className="text-neutral-600">
              {inv.seller.email}
              {inv.seller.phone ? ` · ${inv.seller.phone}` : ""}
            </p>
            {inv.seller.gstin && <p className="mt-1 font-medium">GSTIN: {inv.seller.gstin}</p>}
          </div>
          <div className="text-right">
            <h1 className="text-xl font-semibold tracking-wide uppercase">{inv.documentTitle}</h1>
            <p>
              Invoice no. <span className="font-medium">{inv.invoiceNumber}</span>
            </p>
            <p>Date: {new Date(inv.issuedAt).toLocaleDateString("en-IN")}</p>
            <p>
              Order: {inv.orderNumber} ({new Date(inv.orderDate).toLocaleDateString("en-IN")})
            </p>
            <p>Payment: {inv.paymentMethod}</p>
          </div>
        </header>
        <section className="grid gap-6 border-b py-6 sm:grid-cols-3">
          <div>
            <p className="text-[11px] font-semibold text-neutral-500 uppercase">Bill to</p>
            <p className="font-medium">{inv.buyer.billingAddress.fullName}</p>
            <p className="text-neutral-600">{addr(inv.buyer.billingAddress)}</p>
            <p className="text-neutral-600">
              {inv.buyer.email} · {inv.buyer.phone}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-neutral-500 uppercase">Ship to</p>
            <p className="font-medium">{inv.buyer.shippingAddress.fullName}</p>
            <p className="text-neutral-600">{addr(inv.buyer.shippingAddress)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-neutral-500 uppercase">Place of supply</p>
            <p>
              {inv.placeOfSupply.stateName} ({inv.placeOfSupply.stateCode})
            </p>
            {inv.gstApplicable && (
              <p className="text-neutral-600">
                {intra ? "Intra-state supply (CGST + SGST)" : "Inter-state supply (IGST)"}
              </p>
            )}
          </div>
        </section>
        <table className="mt-6 w-full border-collapse tabular-nums">
          <thead>
            <tr>
              <th className={th}>#</th>
              <th className={th}>Item</th>
              <th className={th}>HSN</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={`${th} text-right`}>Rate</th>
              <th className={`${th} text-right`}>Discount</th>
              <th className={`${th} text-right`}>Taxable</th>
              {inv.gstApplicable &&
                (intra ? (
                  <>
                    <th className={`${th} text-right`}>CGST</th>
                    <th className={`${th} text-right`}>SGST</th>
                  </>
                ) : (
                  <th className={`${th} text-right`}>IGST</th>
                ))}
              <th className={`${th} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i}>
                <td className={td}>{i + 1}</td>
                <td className={td}>
                  {l.description}
                  <div className="text-[11px] text-neutral-500">{l.sku}</div>
                </td>
                <td className={td}>{l.hsn ?? "—"}</td>
                <td className={`${td} text-right`}>{l.quantity}</td>
                <td className={`${td} text-right`}>{formatINRExact(l.unitPricePaise)}</td>
                <td className={`${td} text-right`}>
                  {l.discountPaise ? formatINRExact(l.discountPaise) : "—"}
                </td>
                <td className={`${td} text-right`}>{formatINRExact(l.taxableValuePaise)}</td>
                {inv.gstApplicable &&
                  (intra ? (
                    <>
                      <td className={`${td} text-right`}>
                        {formatINRExact(l.cgstPaise)}
                        <div className="text-[11px] text-neutral-500">
                          {percentFromBps(l.taxRateBps / 2)}
                        </div>
                      </td>
                      <td className={`${td} text-right`}>
                        {formatINRExact(l.sgstPaise)}
                        <div className="text-[11px] text-neutral-500">
                          {percentFromBps(l.taxRateBps / 2)}
                        </div>
                      </td>
                    </>
                  ) : (
                    <td className={`${td} text-right`}>
                      {formatINRExact(l.igstPaise)}
                      <div className="text-[11px] text-neutral-500">
                        {percentFromBps(l.taxRateBps)}
                      </div>
                    </td>
                  ))}
                <td className={`${td} text-right`}>{formatINRExact(l.totalPaise)}</td>
              </tr>
            ))}
            {inv.charges.map((c) => (
              <tr key={c.label}>
                <td className={td} />
                <td className={td} colSpan={5}>
                  {c.label}
                </td>
                <td className={`${td} text-right`}>{formatINRExact(c.taxableValuePaise)}</td>
                {inv.gstApplicable && (
                  <td className={`${td} text-right`} colSpan={intra ? 2 : 1}>
                    {c.taxPaise ? formatINRExact(c.taxPaise) : "—"}
                  </td>
                )}
                <td className={`${td} text-right`}>
                  {formatINRExact(c.taxableValuePaise + c.taxPaise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-6 flex justify-end">
          <dl className="grid w-72 gap-1.5 tabular-nums">
            <div className="flex justify-between">
              <dt>Taxable value</dt>
              <dd>{formatINRExact(inv.totals.taxableValuePaise)}</dd>
            </div>
            {inv.gstApplicable &&
              (intra ? (
                <>
                  <div className="flex justify-between">
                    <dt>CGST</dt>
                    <dd>{formatINRExact(inv.totals.cgstPaise)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>SGST</dt>
                    <dd>{formatINRExact(inv.totals.sgstPaise)}</dd>
                  </div>
                </>
              ) : (
                <div className="flex justify-between">
                  <dt>IGST</dt>
                  <dd>{formatINRExact(inv.totals.igstPaise)}</dd>
                </div>
              ))}
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Grand total</dt>
              <dd>{formatINRExact(inv.totals.grandTotalPaise)}</dd>
            </div>
          </dl>
        </div>
        <footer className="mt-8 border-t pt-4 text-[11px] text-neutral-500">
          {inv.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </footer>
      </article>
    </div>
  );
}
