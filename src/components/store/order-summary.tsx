import { formatINR, percentFromBps } from "@/lib/money";
import type { PriceBreakdown } from "@/server/services/pricing";

/** Server-computed price breakdown. Never computes money on the client. */
export function OrderSummaryRows({
  pricing,
  showTaxSplit = false,
}: {
  pricing: PriceBreakdown;
  showTaxSplit?: boolean;
}) {
  const row = "flex items-center justify-between gap-4";
  return (
    <div className="grid gap-3">
      <dl className="grid gap-3 text-sm">
        <div className={row}>
          <dt className="text-muted-foreground">
            Subtotal ({pricing.itemCount} item{pricing.itemCount === 1 ? "" : "s"})
          </dt>
          <dd className="tabular-nums">{formatINR(pricing.subtotalPaise)}</dd>
        </div>
        {pricing.couponDiscountPaise > 0 && (
          <div className={row}>
            <dt className="text-muted-foreground">
              Coupon{" "}
              {pricing.couponCode && (
                <span className="font-mono text-xs">({pricing.couponCode})</span>
              )}
            </dt>
            <dd className="text-success tabular-nums">−{formatINR(pricing.couponDiscountPaise)}</dd>
          </div>
        )}
        <div className={row}>
          <dt className="text-muted-foreground">Shipping</dt>
          <dd className="tabular-nums">
            {pricing.shippingPaise === 0 ? (
              <span className="text-success">Free</span>
            ) : (
              formatINR(pricing.shippingPaise)
            )}
          </dd>
        </div>
        {pricing.codFeePaise > 0 && (
          <div className={row}>
            <dt className="text-muted-foreground">Cash on Delivery fee</dt>
            <dd className="tabular-nums">{formatINR(pricing.codFeePaise)}</dd>
          </div>
        )}
        {pricing.taxPaise > 0 && !pricing.taxInclusive && (
          <div className={row}>
            <dt className="text-muted-foreground">GST</dt>
            <dd className="tabular-nums">{formatINR(pricing.taxPaise)}</dd>
          </div>
        )}
        <div className={`${row} border-t pt-3 text-base font-semibold`}>
          <dt>Total</dt>
          <dd className="tabular-nums" data-testid="order-total">
            {formatINR(pricing.totalPaise)}
          </dd>
        </div>
      </dl>
      {pricing.taxPaise > 0 && pricing.taxInclusive && (
        <p className="text-muted-foreground -mt-1 text-xs">
          Includes GST of {formatINR(pricing.taxPaise)}
          {showTaxSplit &&
            (pricing.intraState
              ? ` (CGST ${formatINR(pricing.cgstPaise)} + SGST ${formatINR(pricing.sgstPaise)})`
              : ` (IGST ${formatINR(pricing.igstPaise)})`)}
        </p>
      )}
      {pricing.mrpSavingsPaise + pricing.couponDiscountPaise > 0 && (
        <p className="bg-success-soft text-success rounded-lg px-3 py-2 text-xs font-medium">
          You save {formatINR(pricing.mrpSavingsPaise + pricing.couponDiscountPaise)} on this order
        </p>
      )}
    </div>
  );
}

export { percentFromBps };
