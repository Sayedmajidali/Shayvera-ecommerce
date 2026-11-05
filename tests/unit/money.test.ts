import { describe, expect, it } from "vitest";
import {
  applyBps,
  divRound,
  formatINR,
  formatINRExact,
  paiseToRupeesString,
  rupeesToPaise,
} from "@/lib/money";

describe("money", () => {
  it("formats INR with Indian digit grouping", () => {
    expect(formatINR(129_900)).toBe("₹1,299");
    expect(formatINR(12_345_678_90)).toBe("₹1,23,45,678.90");
    expect(formatINR(161_730)).toBe("₹1,617.30");
    expect(formatINRExact(129_950)).toBe("₹1,299.50");
  });
  it("parses rupee input into integer paise without floating point error", () => {
    expect(rupeesToPaise("1,299.50")).toBe(129_950);
    expect(rupeesToPaise("0.1")).toBe(10);
    expect(rupeesToPaise("19.99")).toBe(1999);
    expect(rupeesToPaise(5)).toBe(500);
    expect(() => rupeesToPaise("12.345")).toThrow();
    expect(() => rupeesToPaise("-5")).toThrow();
    expect(() => rupeesToPaise("abc")).toThrow();
  });
  it("rounds half away from zero", () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(4, 3)).toBe(1);
    expect(applyBps(10_000, 1800)).toBe(1800);
    expect(applyBps(333, 1000)).toBe(33);
    expect(applyBps(335, 1000)).toBe(34);
  });
  it("renders paise as rupee strings", () => {
    expect(paiseToRupeesString(129_905)).toBe("1299.05");
    expect(paiseToRupeesString(-50)).toBe("-0.50");
  });
});
