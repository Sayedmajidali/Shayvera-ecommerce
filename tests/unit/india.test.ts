import { describe, expect, it } from "vitest";
import {
  isValidGstin,
  isValidIndianMobile,
  isValidPincode,
  normalizeIndianPhone,
} from "@/lib/india";

describe("India validators", () => {
  it.each([
    "9845012345",
    "+91 98450 12345",
    "+919845012345",
    "09845012345",
    "919845012345",
    "6000000000",
  ])("accepts mobile %s", (n) => expect(isValidIndianMobile(n)).toBe(true));
  it.each(["5845012345", "98450123", "98450123456", "abcdefghij", "+1 9845012345", ""])(
    "rejects mobile %s",
    (n) => expect(isValidIndianMobile(n)).toBe(false),
  );
  it("normalises phone numbers", () => {
    expect(normalizeIndianPhone("+91-98450-12345")).toBe("9845012345");
  });
  it("validates PIN codes", () => {
    expect(isValidPincode("560001")).toBe(true);
    expect(isValidPincode("110001")).toBe(true);
    expect(isValidPincode("012345")).toBe(false);
    expect(isValidPincode("56001")).toBe(false);
    expect(isValidPincode("5600011")).toBe(false);
  });
  it("validates GSTIN structure and checksum", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin("29AAGCB7383J1Z4")).toBe(true);
    expect(isValidGstin("27AAPFU0939F1ZA")).toBe(false); // bad checksum
    expect(isValidGstin("99AAPFU0939F1ZV")).toBe(false); // bad state
    expect(isValidGstin("27AAPFU0939F1Z")).toBe(false);
  });
});
