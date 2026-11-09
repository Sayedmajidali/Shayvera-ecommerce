import { expect, test } from "@playwright/test";

test.describe("cart drawer", () => {
  test("opens on add, updates quantity from server totals, removes, and closes with Escape", async ({
    page,
  }) => {
    await page.goto("/product/cashews-w320");
    await page.getByRole("button", { name: "Add to cart" }).click();

    const drawer = page.getByTestId("cart-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Added to your cart")).toBeVisible();
    const line = drawer.getByTestId("drawer-line");
    await expect(line).toHaveCount(1);
    await expect(line).toContainText("Cashews W320 (Kaju)");
    const before = await line.getByText(/^₹/).last().textContent();

    await line.getByRole("button", { name: "Increase quantity" }).click();
    await expect(line.getByText(/^₹/).last()).not.toHaveText(before ?? "");
    await expect(page.getByTestId("cart-count")).toHaveText("2");

    // Background scrolling is locked while open.
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");

    await line.getByRole("button", { name: /Remove Cashews/ }).click();
    await expect(drawer.getByText("Your cart is empty")).toBeVisible();
    await expect(page.getByText(/Removed Cashews/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("the header cart icon opens the drawer and focus returns to it on close", async ({
    page,
  }) => {
    await page.goto("/");
    const cart = page.getByRole("link", { name: /^Cart, / });
    await cart.click();
    const drawer = page.getByTestId("cart-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Your cart is empty")).toBeVisible();
    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(drawer).toBeHidden();
    await expect(cart).toBeFocused();
    await expect(page).toHaveURL("/"); // the link did not navigate
  });
});

test("quick view shows variants and adds to the cart", async ({ page }) => {
  await page.goto("/shop");
  await page.getByRole("button", { name: "Quick view California Almonds (Badam)" }).click();
  const dialog = page.getByTestId("quick-view");
  await expect(dialog.getByRole("heading", { name: "California Almonds (Badam)" })).toBeVisible();
  await dialog.getByRole("button", { name: "1 kg", exact: true }).click();
  await dialog.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByTestId("cart-drawer")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("drawer-line")).toContainText("1 kg");
});

test("product gallery: next/previous, fullscreen viewer with keyboard navigation", async ({
  page,
}) => {
  await page.goto("/product/cashews-w320");
  const main = page.getByTestId("gallery-main");
  await expect(main.getByText("1 / 3")).toBeVisible();
  await main.hover();
  await main.getByRole("button", { name: "Next image" }).click();
  await expect(main.getByText("2 / 3")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Show image 2 of 3" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByRole("button", { name: "View images fullscreen" }).click();
  const box = page.getByTestId("gallery-lightbox");
  await expect(box).toBeVisible();
  await expect(box.getByText("2 / 3")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(box.getByText("3 / 3")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(box.getByText("1 / 3")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
});

test("sections reveal once while scrolling; the header gains its scrolled state", async ({
  page,
}) => {
  await page.goto("/");
  const header = page.locator("header").first();
  await expect(header).not.toHaveAttribute("data-scrolled");
  // Below-the-fold content waits to be revealed…
  await expect.poll(() => page.locator("[data-reveal-pending]").count()).toBeGreaterThan(0);
  for (let y = 0; y < 8000; y += 500) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(40);
  }
  await expect(header).toHaveAttribute("data-scrolled", "");
  // …and nothing stays hidden once it has been scrolled past.
  await expect.poll(() => page.locator("[data-reveal-pending]").count()).toBe(0);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("no content is ever hidden for an animation", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(300);
    expect(await page.locator("[data-reveal-pending]").count()).toBe(0);
    await expect(page.getByRole("heading", { name: "Bestsellers" })).toBeVisible();
  });
});
