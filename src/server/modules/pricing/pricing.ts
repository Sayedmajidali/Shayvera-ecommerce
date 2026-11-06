/**
 * Centralised pricing engine — pure functions, no I/O.
 * Used by the cart (display), checkout (order creation) and tests, so the numbers a customer
 * sees are exactly the numbers that are charged. All amounts are integer paise.
 *
 * GST model (configurable, must be reviewed by the business's accountant):
 *  - gstEnabled=false → no tax computed or shown (unregistered seller).
 *  - pricesIncludeTax=true → listed prices are GST-inclusive; tax is the included portion.
 *  - pricesIncludeTax=false → tax is added on top of the taxable value.
 *  - Coupon discounts reduce the taxable value of each line (allocated pro-rata).
 *  - Shipping and COD fees are treated as part of a composite supply, taxed at the highest
 *    line rate.
 *  - Intra-state supply (shipping state = store state) → CGST + SGST (half each); otherwise IGST.
 */
import { applyBps, divRound } from "@/lib/money";

export type PricingLineInput = {
  key: string; // variantId
  unitPricePaise: number;
  compareAtPaise?: number | null;
  quantity: number;
  taxRateBps: number | null; // null → store default
};

export type PricingSettings = {
  gstEnabled: boolean;
  pricesIncludeTax: boolean;
  defaultTaxRateBps: number;
  storeStateCode: string;
  shippingFlatPaise: number;
  freeShippingThresholdPaise: number | null;
  codFeePaise: number;
};

export type CouponDefinition = {
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: number; // bps or paise
  minOrderPaise: number;
  maxDiscountPaise: number | null;
  usageLimit: number | null;
  usageLimitPerUser: number | null;
  usedCount: number;
  startsAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
};

export type CouponContext = {
  subtotalPaise: number;
  now: Date;
  /** Prior uses by this customer (user id or email). null → unknown yet (e.g. guest cart). */
  customerUsageCount: number | null;
};

export type CouponResult = { ok: true; discountPaise: number } | { ok: false; reason: string };

export function evaluateCoupon(coupon: CouponDefinition | null, ctx: CouponContext): CouponResult {
  if (!coupon || !coupon.isActive) return { ok: false, reason: "This coupon code is not valid" };
  if (coupon.startsAt && ctx.now < coupon.startsAt)
    return { ok: false, reason: "This coupon is not active yet" };
  if (coupon.expiresAt && ctx.now >= coupon.expiresAt)
    return { ok: false, reason: "This coupon has expired" };
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    return { ok: false, reason: "This coupon has reached its usage limit" };
  }
  if (
    coupon.usageLimitPerUser !== null &&
    ctx.customerUsageCount !== null &&
    ctx.customerUsageCount >= coupon.usageLimitPerUser
  ) {
    return { ok: false, reason: "You have already used this coupon" };
  }
  if (ctx.subtotalPaise < coupon.minOrderPaise) {
    return {
      ok: false,
      reason: `Add items worth ₹${Math.ceil((coupon.minOrderPaise - ctx.subtotalPaise) / 100)} more to use this coupon`,
    };
  }
  let discount =
    coupon.type === "PERCENTAGE" ? applyBps(ctx.subtotalPaise, coupon.value) : coupon.value;
  if (coupon.maxDiscountPaise !== null) discount = Math.min(discount, coupon.maxDiscountPaise);
  discount = Math.max(0, Math.min(discount, ctx.subtotalPaise));
  if (discount === 0) return { ok: false, reason: "This coupon does not apply to your cart" };
  return { ok: true, discountPaise: discount };
}

/** Splits `total` across `weights` proportionally using the largest-remainder method (sums exactly). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i]! += 1;
    remainder--;
  }
  return floors;
}

/** Tax on a base amount. Inclusive: the GST portion contained in `base`. Exclusive: GST on top. */
export function taxOn(base: number, rateBps: number, inclusive: boolean): number {
  if (rateBps <= 0 || base <= 0) return 0;
  if (inclusive) return base - divRound(base * 10_000, 10_000 + rateBps);
  return applyBps(base, rateBps);
}

export function splitGst(tax: number, intraState: boolean) {
  if (!intraState) return { cgst: 0, sgst: 0, igst: tax };
  const cgst = Math.floor(tax / 2);
  return { cgst, sgst: tax - cgst, igst: 0 };
}

export type PricedLine = {
  key: string;
  quantity: number;
  unitPricePaise: number;
  lineSubtotalPaise: number;
  discountPaise: number;
  taxRateBps: number;
  taxPaise: number;
  /** Amount the customer pays for this line (incl. tax if exclusive pricing). */
  lineTotalPaise: number;
  mrpSavingsPaise: number;
};

export type PriceBreakdown = {
  lines: PricedLine[];
  itemCount: number;
  subtotalPaise: number;
  mrpSavingsPaise: number;
  couponCode: string | null;
  couponDiscountPaise: number;
  shippingPaise: number;
  freeShippingRemainingPaise: number | null;
  codFeePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxInclusive: boolean;
  intraState: boolean;
  totalPaise: number;
};

export function priceCart(input: {
  lines: PricingLineInput[];
  settings: PricingSettings;
  coupon?: { code: string; discountPaise: number } | null;
  shippingStateCode?: string | null;
  paymentMethod?: "COD" | "RAZORPAY" | null;
}): PriceBreakdown {
  const { settings } = input;
  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new Error("Invalid line quantity");
    if (!Number.isInteger(l.unitPricePaise) || l.unitPricePaise < 0)
      throw new Error("Invalid unit price");
  }

  const subtotals = input.lines.map((l) => l.unitPricePaise * l.quantity);
  const subtotalPaise = subtotals.reduce((a, b) => a + b, 0);
  const couponDiscountPaise = input.coupon
    ? Math.min(input.coupon.discountPaise, subtotalPaise)
    : 0;
  const discounts = allocate(couponDiscountPaise, subtotals);
  const intraState =
    !input.shippingStateCode || input.shippingStateCode === settings.storeStateCode;
  const inclusive = settings.pricesIncludeTax;

  const lines: PricedLine[] = input.lines.map((l, i) => {
    const rate = settings.gstEnabled ? (l.taxRateBps ?? settings.defaultTaxRateBps) : 0;
    const base = subtotals[i]! - discounts[i]!;
    const tax = settings.gstEnabled ? taxOn(base, rate, inclusive) : 0;
    return {
      key: l.key,
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise,
      lineSubtotalPaise: subtotals[i]!,
      discountPaise: discounts[i]!,
      taxRateBps: rate,
      taxPaise: tax,
      lineTotalPaise: base + (inclusive ? 0 : tax),
      mrpSavingsPaise:
        l.compareAtPaise && l.compareAtPaise > l.unitPricePaise
          ? (l.compareAtPaise - l.unitPricePaise) * l.quantity
          : 0,
    };
  });

  const merchandise = subtotalPaise - couponDiscountPaise;
  const threshold = settings.freeShippingThresholdPaise;
  const qualifiesFree = threshold !== null && merchandise >= threshold;
  const shippingPaise = lines.length === 0 || qualifiesFree ? 0 : settings.shippingFlatPaise;
  const codFeePaise = input.paymentMethod === "COD" && lines.length > 0 ? settings.codFeePaise : 0;

  const maxRate = lines.reduce((m, l) => Math.max(m, l.taxRateBps), 0);
  const chargesTax = settings.gstEnabled
    ? taxOn(shippingPaise + codFeePaise, maxRate, inclusive)
    : 0;
  const taxPaise = lines.reduce((s, l) => s + l.taxPaise, 0) + chargesTax;
  const split = splitGst(taxPaise, intraState);

  const totalPaise = merchandise + shippingPaise + codFeePaise + (inclusive ? 0 : taxPaise);

  return {
    lines,
    itemCount: input.lines.reduce((s, l) => s + l.quantity, 0),
    subtotalPaise,
    mrpSavingsPaise: lines.reduce((s, l) => s + l.mrpSavingsPaise, 0),
    couponCode: input.coupon && couponDiscountPaise > 0 ? input.coupon.code : null,
    couponDiscountPaise,
    shippingPaise,
    freeShippingRemainingPaise:
      threshold !== null && !qualifiesFree ? threshold - merchandise : null,
    codFeePaise,
    taxPaise,
    cgstPaise: split.cgst,
    sgstPaise: split.sgst,
    igstPaise: split.igst,
    taxInclusive: inclusive,
    intraState,
    totalPaise,
  };
}

export function settingsToPricing(s: {
  gstEnabled: boolean;
  pricesIncludeTax: boolean;
  defaultTaxRateBps: number;
  stateCode: string;
  shippingFlatPaise: number;
  freeShippingThresholdPaise: number | null;
  codFeePaise: number;
}): PricingSettings {
  return {
    gstEnabled: s.gstEnabled,
    pricesIncludeTax: s.pricesIncludeTax,
    defaultTaxRateBps: s.defaultTaxRateBps,
    storeStateCode: s.stateCode,
    shippingFlatPaise: s.shippingFlatPaise,
    freeShippingThresholdPaise: s.freeShippingThresholdPaise,
    codFeePaise: s.codFeePaise,
  };
}
