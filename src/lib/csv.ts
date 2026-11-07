/**
 * Minimal RFC 4180 CSV writer. Cells that a spreadsheet would treat as a formula (= + - @, tab or
 * carriage return first) are prefixed with an apostrophe to prevent CSV/formula injection from
 * customer-entered text such as names or coupon codes.
 */
export type CsvCell = string | number | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  // BOM so Excel opens UTF-8 (₹, Hindi names) correctly.
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
