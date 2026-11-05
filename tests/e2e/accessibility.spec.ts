import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN, addProductToCart, login } from "./helpers";

const scan = async (page: import("@playwright/test").Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  // Fail on serious/critical issues; report the rest.
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  if (blocking.length)
    console.log(
      JSON.stringify(
        blocking.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.slice(0, 3).map((n) => n.target),
        })),
        null,
        2,
      ),
    );
  return blocking;
};

test.describe("accessibility (axe, WCAG 2.1 AA)", () => {
  for (const path of [
    "/",
    "/shop",
    "/category/kitchen-dining",
    "/product/handloom-cushion-cover",
    "/search?q=mug",
    "/login",
    "/register",
    "/contact",
    "/shipping-returns",
  ]) {
    test(`no serious violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      expect(await scan(page)).toEqual([]);
    });
  }

  test("cart and checkout", async ({ page }) => {
    await addProductToCart(page, "stoneware-coffee-mug");
    await page.goto("/cart");
    expect(await scan(page)).toEqual([]);
    await page.goto("/checkout");
    expect(await scan(page)).toEqual([]);
  });

  test("admin dashboard and product editor", async ({ page }) => {
    await login(page, ADMIN, "/admin");
    expect(await scan(page)).toEqual([]);
    await page.goto("/admin/products");
    expect(await scan(page)).toEqual([]);
  });
});
