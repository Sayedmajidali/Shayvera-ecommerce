/** Money helpers. All amounts are integer paise. */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const inrExact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹1,299 for whole rupees, ₹1,299.50 otherwise (never "₹1,299.5"). */
export function formatINR(paise: number): string {
  return paise % 100 === 0 ? inr.format(paise / 100) : inrExact.format(paise / 100);
}

/** Always two decimals — for invoices and accounting views. */
export function formatINRExact(paise: number): string {
  return inrExact.format(paise / 100);
}

/** Parses a rupee string/number entered by an admin ("1,299.50") into integer paise. */
export function rupeesToPaise(input: string | number): number {
  const s = typeof input === "number" ? input.toString() : input.replace(/[,₹\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid rupee amount: ${input}`);
  const [whole = "0", frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function paiseToRupeesString(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Integer division rounding half away from zero — the only rounding used for money. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error("Division by zero");
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * n + d) / (2 * d));
}

/** Applies basis points to an amount with half-up rounding: bps(10000, 1800) = 1800. */
export function applyBps(amountPaise: number, bps: number): number {
  return divRound(amountPaise * bps, 10_000);
}

export function percentFromBps(bps: number): string {
  const v = bps / 100;
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(2).replace(/0$/, "")}%`;
}
