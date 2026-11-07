import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";

describe("csv", () => {
  it("quotes separators, quotes and newlines", () => {
    expect(csvCell('Cashews "W320", 250 g')).toBe('"Cashews ""W320"", 250 g"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12)).toBe("12");
  });

  it("neutralises text a spreadsheet would run as a formula", () => {
    for (const s of ["=1+1", "+91", "-2", "@SUM(A1)", "\tx"])
      expect(csvCell(s).startsWith("'") || csvCell(s).startsWith("\"'")).toBe(true);
    // Numbers stay numbers (negative refunds, amounts).
    expect(csvCell(-250)).toBe("-250");
  });

  it("writes a UTF-8 BOM and CRLF rows", () => {
    expect(toCsv(["a", "b"], [["₹1", 2]])).toBe("﻿a,b\r\n₹1,2\r\n");
  });
});
