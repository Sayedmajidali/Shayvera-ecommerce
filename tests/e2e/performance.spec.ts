import { expect, test, type Page } from "@playwright/test";
import { ADMIN, login } from "./helpers";

type Metrics = { jsKb: number; totalKb: number; requests: number; ttfbMs: number; domMs: number };

/** Loads a page cold and measures transferred bytes (compressed) and navigation timing. */
async function measure(page: Page, path: string): Promise<Metrics> {
  const sizes: { type: string; bytes: number }[] = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const types = new Map<string, string>();
  cdp.on("Network.responseReceived", (e) => types.set(e.requestId, e.type));
  cdp.on("Network.loadingFinished", (e) =>
    sizes.push({ type: types.get(e.requestId) ?? "Other", bytes: e.encodedDataLength }),
  );
  await page.goto(path, { waitUntil: "networkidle" });
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return {
      ttfb: n.responseStart - n.requestStart,
      dom: n.domContentLoadedEventEnd - n.startTime,
    };
  });
  await cdp.detach();
  const kb = (b: number) => Math.round(b / 1024);
  return {
    jsKb: kb(sizes.filter((s) => s.type === "Script").reduce((t, s) => t + s.bytes, 0)),
    totalKb: kb(sizes.reduce((t, s) => t + s.bytes, 0)),
    requests: sizes.length,
    ttfbMs: Math.round(nav.ttfb),
    domMs: Math.round(nav.dom),
  };
}

// Budgets for the production build (compressed transfer). Generous enough for CI noise; they catch
// regressions such as a heavy library landing in the storefront bundle or an uncached slow query.
// JS budget: /login carries the sign-in, sign-up and emailed-code (OTP) forms, ~252 KB.
const STOREFRONT = { jsKb: 260, ttfbMs: 1500 };

test.describe("performance budgets", () => {
  for (const path of ["/", "/shop", "/product/cashews-w320", "/cart", "/login"]) {
    test(`storefront ${path}`, async ({ page }) => {
      const m = await measure(page, path);
      console.log(`PERF ${path} ${JSON.stringify(m)}`);
      expect(m.jsKb, "JavaScript (KB, compressed)").toBeLessThanOrEqual(STOREFRONT.jsKb);
      expect(m.ttfbMs, "time to first byte (ms)").toBeLessThanOrEqual(STOREFRONT.ttfbMs);
    });
  }

  test("admin dashboard", async ({ page }) => {
    await login(page, ADMIN, "/admin");
    const m = await measure(page, "/admin");
    console.log(`PERF /admin ${JSON.stringify(m)}`);
    expect(m.ttfbMs).toBeLessThanOrEqual(2000);
  });
});
