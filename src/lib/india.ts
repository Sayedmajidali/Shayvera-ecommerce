/** India-specific reference data and validators. */

export const INDIAN_STATES = [
  { code: "AN", name: "Andaman and Nicobar Islands", gst: "35" },
  { code: "AP", name: "Andhra Pradesh", gst: "37" },
  { code: "AR", name: "Arunachal Pradesh", gst: "12" },
  { code: "AS", name: "Assam", gst: "18" },
  { code: "BR", name: "Bihar", gst: "10" },
  { code: "CH", name: "Chandigarh", gst: "04" },
  { code: "CG", name: "Chhattisgarh", gst: "22" },
  { code: "DH", name: "Dadra and Nagar Haveli and Daman and Diu", gst: "26" },
  { code: "DL", name: "Delhi", gst: "07" },
  { code: "GA", name: "Goa", gst: "30" },
  { code: "GJ", name: "Gujarat", gst: "24" },
  { code: "HR", name: "Haryana", gst: "06" },
  { code: "HP", name: "Himachal Pradesh", gst: "02" },
  { code: "JK", name: "Jammu and Kashmir", gst: "01" },
  { code: "JH", name: "Jharkhand", gst: "20" },
  { code: "KA", name: "Karnataka", gst: "29" },
  { code: "KL", name: "Kerala", gst: "32" },
  { code: "LA", name: "Ladakh", gst: "38" },
  { code: "LD", name: "Lakshadweep", gst: "31" },
  { code: "MP", name: "Madhya Pradesh", gst: "23" },
  { code: "MH", name: "Maharashtra", gst: "27" },
  { code: "MN", name: "Manipur", gst: "14" },
  { code: "ML", name: "Meghalaya", gst: "17" },
  { code: "MZ", name: "Mizoram", gst: "15" },
  { code: "NL", name: "Nagaland", gst: "13" },
  { code: "OD", name: "Odisha", gst: "21" },
  { code: "PY", name: "Puducherry", gst: "34" },
  { code: "PB", name: "Punjab", gst: "03" },
  { code: "RJ", name: "Rajasthan", gst: "08" },
  { code: "SK", name: "Sikkim", gst: "11" },
  { code: "TN", name: "Tamil Nadu", gst: "33" },
  { code: "TS", name: "Telangana", gst: "36" },
  { code: "TR", name: "Tripura", gst: "16" },
  { code: "UP", name: "Uttar Pradesh", gst: "09" },
  { code: "UK", name: "Uttarakhand", gst: "05" },
  { code: "WB", name: "West Bengal", gst: "19" },
] as const;

export type StateCode = (typeof INDIAN_STATES)[number]["code"];
export const STATE_CODES = INDIAN_STATES.map((s) => s.code) as [StateCode, ...StateCode[]];

export function stateName(code: string): string {
  return INDIAN_STATES.find((s) => s.code === code)?.name ?? code;
}

/** Normalises Indian mobile numbers: strips spaces/dashes, +91/91/0 prefixes → 10 digits. */
export function normalizeIndianPhone(input: string): string {
  let d = input.replace(/[\s\-()]/g, "");
  if (d.startsWith("+91")) d = d.slice(3);
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

/** Indian mobile numbers: 10 digits starting 6–9. */
export function isValidIndianMobile(input: string): boolean {
  return /^[6-9]\d{9}$/.test(normalizeIndianPhone(input));
}

/** PIN codes: 6 digits, first digit 1–9. */
export function isValidPincode(input: string): boolean {
  return /^[1-9]\d{5}$/.test(input.trim());
}

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Validates GSTIN structure, state code and the mod-36 check character. */
export function isValidGstin(input: string): boolean {
  const g = input.trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  if (!INDIAN_STATES.some((s) => s.gst === g.slice(0, 2)) && g.slice(0, 2) !== "97") return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(g[i]!);
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = GSTIN_CHARS[(36 - (sum % 36)) % 36];
  return check === g[14];
}

export function gstStateCodeFromGstin(gstin: string): string | undefined {
  const prefix = gstin.slice(0, 2);
  return INDIAN_STATES.find((s) => s.gst === prefix)?.code;
}

/** E.164 form (+91XXXXXXXXXX) of a valid Indian mobile number, or null. Used as the OTP login id. */
export function toE164IndianMobile(input: string): string | null {
  const d = normalizeIndianPhone(input);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

/** Accounts created by phone sign-in get a non-deliverable placeholder email (RFC 2606 `.invalid`). */
export const PHONE_PLACEHOLDER_EMAIL_DOMAIN = "phone.invalid";

export function phonePlaceholderEmail(e164: string): string {
  return `${e164.replace(/\D/g, "")}@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}`);
}

/** Formats +91XXXXXXXXXX as "+91 98450 12345" for display. */
export function formatIndianMobile(e164: string): string {
  const d = normalizeIndianPhone(e164);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : e164;
}
