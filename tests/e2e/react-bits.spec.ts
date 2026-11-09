import { expect, test } from "@playwright/test";
import { ADMIN, CUSTOMER, addProductToCart, login } from "./helpers";

test("home: star-border CTA, trust strip and pantry gallery work and link to real products", async ({
  page,
}) => {
  await page.goto("/");
  const cta = page.getByRole("link", { name: "Shop the pantry" });
  await expect(cta).toBeVisible();
  // Trust strip (LogoLoop) and pantry gallery (Masonry) upgrade as they approach.
  const trust = page.getByRole("region", { name: "Why shop with us" });
  await trust.scrollIntoViewIfNeeded();
  await expect(trust.getByText("Cash on Delivery").first()).toBeVisible();
  const gallery = page.getByText("A closer look");
  await gallery.scrollIntoViewIfNeeded();
  const tile = gallery
    .locator("xpath=ancestor::section[1]")
    .getByRole("button", { name: "California Almonds (Badam)", exact: true })
    .or(page.getByRole("link", { name: "California Almonds (Badam)", exact: true }));
  await tile.first().click();
  await expect(page).toHaveURL(/\/product\/california-almonds/);
  await page.goto("/");
  await cta.click();
  await expect(page).toHaveURL(/\/shop/);
});

test("about page shows store figures computed from real orders", async ({ page }) => {
  await page.goto("/about");
  const figures = page.locator("dl");
  await figures.scrollIntoViewIfNeeded();
  await expect(figures.getByText("Products in our pantry")).toBeVisible();
  await expect(figures.getByText(/^\d+$/).first()).toBeVisible();
});

test("customers rate a product with PeekRating; staff approve it and it is published", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, CUSTOMER);
  await page.goto("/product/chole-masala#reviews");
  await page.getByRole("button", { name: /Write a review|Edit your review/ }).click();
  await page.getByRole("radio", { name: "Very good" }).click();
  await page.getByLabel("Your review").fill("Rich, balanced masala — our Sunday chole is back.");
  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(page.getByText("Your review will appear once it’s approved.")).toBeVisible();
  await ctx.close();

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, ADMIN, "/admin/reviews");
  const row = admin.getByTestId("admin-review").filter({ hasText: "our Sunday chole is back" });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByText("Review published")).toBeVisible();
  await admin.goto("/product/chole-masala");
  await expect(admin.getByText("Rich, balanced masala — our Sunday chole is back.")).toBeVisible();
  await adminCtx.close();
});

test("checkout shows its progress and follows the shopper", async ({ page }) => {
  await addProductToCart(page, "cashews-w320");
  await page.goto("/checkout");
  const progress = page.getByTestId("checkout-progress");
  await expect(progress.getByText("Address")).toBeVisible();
  await expect(progress.getByText("Payment")).toBeVisible();
  await expect(progress.getByText("Review")).toBeVisible();
  await progress.getByText("Payment").click();
  await expect(page.locator("#checkout-payment")).toBeInViewport();
});
