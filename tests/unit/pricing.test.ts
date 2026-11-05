import { describe, expect, it } from "vitest";
import {
  allocate,
  evaluateCoupon,
  priceCart,
  splitGst,
  taxOn,
  type CouponDefinition,
  type PricingSettings,
} from "@/server/services/pricing";

const base: PricingSettings = {
  gstEnabled: false,
  pricesIncludeTax: true,
  defaultTaxRateBps: 1800,
  storeStateCode: "KA",
  shippingFlatPaise: 9900,
  freeShippingThresholdPaise: 99_900,
  codFeePaise: 4900,
};

const coupon = (o: Partial<CouponDefinition> = {}): CouponDefinition => ({
  code: "TEST",
  type: "PERCENTAGE",
  value: 1000,
  minOrderPaise: 0,
  maxDiscountPaise: null,
  usageLimit: null,
  usageLimitPerUser: null,
  usedCount: 0,
  startsAt: null,
  expiresAt: null,
  isActive: true,
  ...o,
});
const now = new Date("2026-11-05T10:00:00Z");

describe("allocate", () => {
  it("allocates exactly with largest remainder", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [5000, 3000, 2000])).toEqual([500, 300, 200]);
    expect(allocate(7, [0, 0])).toEqual([0, 0]);
    const parts = allocate(9_999, [12_345, 678, 90_001]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(9_999);
  });
});

describe("tax helpers", () => {
  it("extracts inclusive GST and adds exclusive GST", () => {
    expect(taxOn(11_800, 1800, true)).toBe(1800);
    expect(taxOn(10_000, 1800, false)).toBe(1800);
    expect(taxOn(59_000, 1200, true)).toBe(6321); // 59000 - round(59000/1.12)=52679
    expect(taxOn(1000, 0, true)).toBe(0);
  });
  it("splits intra-state tax into CGST/SGST and inter-state into IGST", () => {
    expect(splitGst(1801, true)).toEqual({ cgst: 900, sgst: 901, igst: 0 });
    expect(splitGst(1801, false)).toEqual({ cgst: 0, sgst: 0, igst: 1801 });
  });
});

describe("coupon eligibility", () => {
  const ctx = { subtotalPaise: 200_000, now, customerUsageCount: 0 };
  it("computes percentage discounts with a cap", () => {
    expect(evaluateCoupon(coupon(), ctx)).toEqual({ ok: true, discountPaise: 20_000 });
    expect(evaluateCoupon(coupon({ maxDiscountPaise: 5000 }), ctx)).toEqual({
      ok: true,
      discountPaise: 5000,
    });
  });
  it("never discounts more than the subtotal", () => {
    expect(evaluateCoupon(coupon({ type: "FIXED", value: 500_000 }), ctx)).toEqual({
      ok: true,
      discountPaise: 200_000,
    });
  });
  it.each([
    [{ isActive: false }, "not valid"],
    [{ expiresAt: new Date("2026-11-01") }, "expired"],
    [{ startsAt: new Date("2026-12-01") }, "not active yet"],
    [{ usageLimit: 10, usedCount: 10 }, "usage limit"],
    [{ minOrderPaise: 300_000 }, "more to use"],
  ])("rejects %o", (o, msg) => {
    const r = evaluateCoupon(coupon(o), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(msg);
  });
  it("enforces per-customer limits only when the customer is known", () => {
    const c = coupon({ usageLimitPerUser: 1 });
    expect(evaluateCoupon(c, { ...ctx, customerUsageCount: 1 }).ok).toBe(false);
    expect(evaluateCoupon(c, { ...ctx, customerUsageCount: null }).ok).toBe(true);
  });
  it("rejects null coupons", () => expect(evaluateCoupon(null, ctx).ok).toBe(false));
});

describe("priceCart", () => {
  const lines = [
    { key: "a", unitPricePaise: 59_000, compareAtPaise: 69_000, quantity: 2, taxRateBps: 1200 },
    { key: "b", unitPricePaise: 34_900, quantity: 1, taxRateBps: 1800 },
  ];

  it("computes subtotal, savings, free shipping and total without GST", () => {
    const r = priceCart({ lines, settings: base });
    expect(r.subtotalPaise).toBe(152_900);
    expect(r.mrpSavingsPaise).toBe(20_000);
    expect(r.shippingPaise).toBe(0);
    expect(r.taxPaise).toBe(0);
    expect(r.totalPaise).toBe(152_900);
    expect(r.itemCount).toBe(3);
  });

  it("charges flat shipping below the threshold and reports remaining amount", () => {
    const r = priceCart({ lines: [lines[1]!], settings: base });
    expect(r.shippingPaise).toBe(9900);
    expect(r.freeShippingRemainingPaise).toBe(99_900 - 34_900);
    expect(r.totalPaise).toBe(34_900 + 9900);
  });

  it("applies coupon before the free shipping threshold", () => {
    const r = priceCart({
      lines: [{ key: "x", unitPricePaise: 100_000, quantity: 1, taxRateBps: null }],
      settings: base,
      coupon: { code: "FLAT", discountPaise: 20_000 },
    });
    expect(r.couponDiscountPaise).toBe(20_000);
    expect(r.shippingPaise).toBe(9900);
    expect(r.totalPaise).toBe(80_000 + 9900);
  });

  it("adds the COD fee only for COD", () => {
    expect(priceCart({ lines, settings: base, paymentMethod: "COD" }).codFeePaise).toBe(4900);
    expect(priceCart({ lines, settings: base, paymentMethod: "RAZORPAY" }).codFeePaise).toBe(0);
  });

  it("extracts inclusive GST per line and splits intra-state", () => {
    const s = { ...base, gstEnabled: true };
    const r = priceCart({ lines, settings: s, shippingStateCode: "KA" });
    // a: 118000 @12% incl → 118000 - round(118000/1.12)= 12643 ; b: 34900 @18% → 34900 - round(34900/1.18)=5324
    expect(r.lines.map((l) => l.taxPaise)).toEqual([12_643, 5324]);
    expect(r.taxPaise).toBe(17_967);
    expect(r.cgstPaise + r.sgstPaise).toBe(17_967);
    expect(r.igstPaise).toBe(0);
    expect(r.totalPaise).toBe(152_900); // inclusive → total unchanged
  });

  it("uses IGST for inter-state supply", () => {
    const r = priceCart({
      lines,
      settings: { ...base, gstEnabled: true },
      shippingStateCode: "MH",
    });
    expect(r.igstPaise).toBe(r.taxPaise);
    expect(r.cgstPaise).toBe(0);
    expect(r.intraState).toBe(false);
  });

  it("adds exclusive GST on top, including on shipping at the highest line rate", () => {
    const s = { ...base, gstEnabled: true, pricesIncludeTax: false };
    const r = priceCart({
      lines: [{ key: "b", unitPricePaise: 10_000, quantity: 1, taxRateBps: 1800 }],
      settings: s,
      shippingStateCode: "KA",
    });
    expect(r.shippingPaise).toBe(9900);
    expect(r.taxPaise).toBe(1800 + 1782);
    expect(r.totalPaise).toBe(10_000 + 9900 + 3582);
  });

  it("reduces taxable value by allocated coupon discount", () => {
    const s = { ...base, gstEnabled: true };
    const r = priceCart({
      lines: [{ key: "x", unitPricePaise: 11_800, quantity: 1, taxRateBps: 1800 }],
      settings: { ...s, freeShippingThresholdPaise: 0 },
      coupon: { code: "C", discountPaise: 1180 },
    });
    expect(r.lines[0]!.discountPaise).toBe(1180);
    expect(r.taxPaise).toBe(1620);
    expect(r.totalPaise).toBe(10_620);
  });

  it("returns zeros for an empty cart and rejects invalid quantities", () => {
    const r = priceCart({ lines: [], settings: base, paymentMethod: "COD" });
    expect(r.totalPaise).toBe(0);
    expect(r.shippingPaise).toBe(0);
    expect(r.codFeePaise).toBe(0);
    expect(() =>
      priceCart({
        lines: [{ key: "x", unitPricePaise: 100, quantity: 0, taxRateBps: null }],
        settings: base,
      }),
    ).toThrow();
    expect(() =>
      priceCart({
        lines: [{ key: "x", unitPricePaise: 100, quantity: 1.5, taxRateBps: null }],
        settings: base,
      }),
    ).toThrow();
  });

  it("always returns integer paise", () => {
    const s = { ...base, gstEnabled: true, pricesIncludeTax: false };
    const r = priceCart({
      lines: [
        { key: "x", unitPricePaise: 333, quantity: 7, taxRateBps: 500 },
        { key: "y", unitPricePaise: 999, quantity: 3, taxRateBps: 2800 },
      ],
      settings: s,
      coupon: { code: "C", discountPaise: 777 },
      shippingStateCode: "TN",
      paymentMethod: "COD",
    });
    for (const v of [r.totalPaise, r.taxPaise, r.igstPaise, ...r.lines.map((l) => l.taxPaise)])
      expect(Number.isInteger(v)).toBe(true);
  });
});
