import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, CUSTOMER, addProductToCart, login } from "./helpers";

/**
 * axe-core against WCAG 2.1 A/AA. Serious, critical **and moderate** violations fail the test (moderate
 * covers landmarks, heading order and page headings); minor ones are printed for review.
 */
const scan = async (page: Page) => {
  // Let entrance animations (fade-ins, page transitions) finish: users read the settled page, and a
  // mid-fade element would be judged on blended colours. Infinite/scroll-linked animations are ignored.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.playState !== "running" ||
          !(a.timeline instanceof DocumentTimeline) ||
          a.effect?.getComputedTiming().iterations === Infinity,
      ),
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact !== "minor");
  const report = (list: typeof results.violations) =>
    list.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target),
    }));
  const minor = results.violations.filter((v) => v.impact === "minor");
  if (minor.length)
    console.log(`minor a11y issues on ${page.url()}`, JSON.stringify(report(minor)));
  if (blocking.length) console.log(JSON.stringify(report(blocking), null, 2));
  return report(blocking);
};

test.describe("accessibility (axe, WCAG 2.1 AA)", () => {
  for (const path of [
    "/",
    "/shop",
    "/category/dry-fruits",
    "/product/makhana-himalayan-salt-pepper",
    "/search?q=makhana",
    "/cart",
    "/login",
    "/register",
    "/forgot-password",
    "/track",
    "/about",
    "/contact",
    "/shipping-returns",
    "/privacy",
    "/this-page-does-not-exist",
  ]) {
    test(`no violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      expect(await scan(page)).toEqual([]);
    });
  }

  test("cart and checkout with items", async ({ page }) => {
    await addProductToCart(page, "california-almonds");
    await page.goto("/cart");
    expect(await scan(page)).toEqual([]);
    await page.goto("/checkout");
    expect(await scan(page)).toEqual([]);
    // Validation errors are announced and linked to their fields.
    await page.getByTestId("place-order").click();
    expect(await scan(page)).toEqual([]);
  });

  test("customer account pages and the account menu", async ({ page }) => {
    await login(page, CUSTOMER, "/account");
    for (const path of ["/account", "/account/orders", "/account/addresses", "/account/wishlist"]) {
      await page.goto(path);
      expect(await scan(page), path).toEqual([]);
    }
    await page.goto("/shop");
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    expect(await scan(page), "account menu open").toEqual([]);
  });

  test("admin pages", async ({ page }) => {
    await login(page, ADMIN, "/admin");
    for (const path of [
      "/admin",
      "/admin/orders",
      "/admin/requests",
      "/admin/payments",
      "/admin/shipments",
      "/admin/invoices",
      "/admin/reports",
      "/admin/products",
      "/admin/products/new",
      "/admin/categories",
      "/admin/inventory",
      "/admin/customers",
      "/admin/coupons",
      "/admin/settings",
      "/admin/staff",
      "/admin/audit-log",
      "/admin/emails",
      "/admin/jobs",
    ]) {
      await page.goto(path);
      expect(await scan(page), path).toEqual([]);
    }
  });
});

test.describe("keyboard navigation", () => {
  test("skip link, focus indicators and dialogs work without a mouse", async ({ page }) => {
    await page.goto("/shop");
    // The first Tab lands on the skip link, which moves focus to the main content.
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);

    // Focus is visible: focused controls get an outline or ring.
    await page.keyboard.press("Tab");
    const visible = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return false;
      const s = getComputedStyle(el);
      return (s.outlineStyle !== "none" && s.outlineWidth !== "0px") || s.boxShadow !== "none";
    });
    expect(visible, "focused element shows a focus indicator").toBe(true);

    // Each product is a single tab stop (the image link duplicates the title link and is skipped).
    const tabbableProductLinks = await page
      .locator('main a[href^="/product/"]:not([tabindex="-1"])')
      .count();
    const cards = await page.locator("main article").count();
    expect(tabbableProductLinks).toBe(cards);
  });

  test("dialogs trap focus, close with Escape and return focus", async ({ page }) => {
    await addProductToCart(page, "california-almonds");
    await page.goto("/");
    await page.setViewportSize({ width: 390, height: 844 });
    const menuButton = page.getByRole("button", { name: /menu/i }).first();
    await menuButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Focus moved into the dialog and stays there.
    for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menuButton).toBeFocused();
  });

  test("a product can be chosen and added to the cart with the keyboard", async ({ page }) => {
    await page.goto("/product/cashews-w320");
    const add = page.getByRole("button", { name: "Add to cart" });
    await add.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Added to your cart")).toBeVisible();
  });
});
