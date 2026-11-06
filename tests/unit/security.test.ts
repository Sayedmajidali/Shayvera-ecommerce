import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { assertSafeKey, LocalStorageProvider } from "@/server/platform/storage/local";
import { clientIp } from "@/server/modules/audit/audit";
import { sniffImageType } from "@/server/modules/catalog/image-upload";
import { escapeHtml } from "@/server/modules/notifications/email-service";

describe("open redirect protection", () => {
  it.each([
    ["/account/orders", "/account/orders"],
    ["/checkout?x=1", "/checkout?x=1"],
    ["//evil.com", "/account"],
    ["/\\evil.com", "/account"],
    ["https://evil.com", "/account"],
    ["javascript:alert(1)", "/account"],
    ["/ok\r\nSet-Cookie: x=1", "/account"],
    [null, "/account"],
  ])("%s → %s", (input, expected) =>
    expect(safeRedirectPath(input as string | null)).toBe(expected),
  );
});

describe("storage keys", () => {
  it.each(["../.env", "products/../../.env", "/etc/passwd", "a//b", "..", "products/x.webp\0"])(
    "rejects %s",
    (k) => {
      expect(() => assertSafeKey(k)).toThrow();
    },
  );
  it("accepts generated keys and never reads outside the root", async () => {
    expect(() => assertSafeKey("products/0b4c-uuid.webp")).not.toThrow();
    const s = new LocalStorageProvider("./storage/test-uploads");
    expect(await s.get("../../package.json")).toBeNull();
  });
});

describe("client IP derivation", () => {
  const req = (h: Record<string, string>) => new Request("http://x", { headers: h });
  it("uses the right-most X-Forwarded-For entry (set by the trusted proxy)", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1, 10.0.0.5" }))).toBe("10.0.0.5");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(req({}))).toBeNull();
  });
});

describe("content sniffing & escaping", () => {
  it("identifies images by magic bytes, not names", () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      "jpeg",
    );
    expect(sniffImageType(Buffer.from("GIF89a-not-allowed-here"))).toBeNull();
    expect(sniffImageType(Buffer.from("<?php system($_GET[1]); ?>"))).toBeNull();
  });
  it("escapes HTML in emails", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;",
    );
  });
});
