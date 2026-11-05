import { expect, test } from "@playwright/test";
import { addProductToCart, db } from "./helpers";

test.describe("edge cases", () => {
  test("out-of-stock variants cannot be added", async ({ page }) => {
    await page.goto("/product/cinnamon-sticks");
    await page.getByRole("button", { name: "100 g (out of stock)" }).click();
    await expect(page.getByText("Sold out").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Sold out" })).toBeDisabled();
  });

  test("invalid and expired coupons are rejected with clear messages", async ({ page }) => {
    await addProductToCart(page, "green-cardamom");
    await page.goto("/cart");
    await page.getByLabel("Coupon code").fill("NOTREAL");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("This coupon code is not valid")).toBeVisible();
    await page.getByLabel("Coupon code").fill("EXPIRED50");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("This coupon has expired")).toBeVisible();
  });

  test("stock that disappears before checkout blocks the order", async ({ page }) => {
    await addProductToCart(page, "black-pepper-whole", { option: "250 g" });
    await db.inventory.updateMany({
      where: { variant: { product: { slug: "black-pepper-whole" }, name: "250 g" } },
      data: { quantityOnHand: 0 },
    });
    await page.goto("/cart");
    await expect(page.getByRole("alert").filter({ hasText: "out of stock" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Proceed to checkout" })).toBeDisabled();
    await page.goto("/checkout");
    await expect(page).toHaveURL(/\/cart/);
  });

  test("signed-out users are redirected from protected pages", async ({ page }) => {
    await page.goto("/account/orders");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Forders/);
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/login/);
  });

  test("unknown pages render the branded 404", async ({ page }) => {
    const res = await page.goto("/product/does-not-exist");
    expect(res?.status()).toBe(404);
    await expect(page.getByText("We couldn’t find that page")).toBeVisible();
  });
});
