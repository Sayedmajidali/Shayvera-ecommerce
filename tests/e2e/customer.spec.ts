import { expect, test } from "@playwright/test";
import { addProductToCart, db, fillCheckout, orderFromUrl, register } from "./helpers";

test.describe("customer shopping journey", () => {
  test("browse, search, filter and view a product", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Everyday objects/ })).toBeVisible();
    await page.getByRole("link", { name: "Shop the collection" }).click();
    await expect(page.getByRole("heading", { name: "Shop all" })).toBeVisible();
    await expect(page.getByTestId("product-card").first()).toBeVisible();

    // Search with live suggestions.
    const search = page.getByRole("combobox").first();
    await search.fill("mug");
    await expect(page.getByRole("option", { name: /Stoneware Coffee Mug/ })).toBeVisible();
    await search.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=mug/);
    await expect(
      page.getByTestId("product-card").filter({ hasText: "Stoneware Coffee Mug" }),
    ).toBeVisible();

    // Category + price filters.
    await page.goto("/shop");
    await page
      .getByRole("complementary", { name: "Filters" })
      .getByRole("button", { name: "Stationery" })
      .click();
    await expect(page).toHaveURL(/category=stationery/);
    await expect(page.getByText("3 products")).toBeVisible();
    await page.getByLabel("Minimum price").fill("800");
    await page.getByLabel("Maximum price").fill("1000");
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await expect(page).toHaveURL(/minPrice=800/);
    await expect(page.getByTestId("product-card")).toHaveCount(1);
    await expect(page.getByTestId("product-card")).toContainText("Undated Weekly Planner");

    // Sort.
    await page.goto("/shop?sort=price-asc");
    await expect(page.getByTestId("product-card").first()).toContainText("Cold-Process Soap");

    // Product detail.
    await page.getByRole("link", { name: "Cold-Process Soap — Sandalwood" }).first().click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Cold-Process Soap — Sandalwood" }),
    ).toBeVisible();
    await expect(page.getByText("Inclusive of all taxes")).toBeVisible();
  });

  test("cart → coupon → COD checkout → order history", async ({ page }) => {
    await register(page, "Riya Kapoor");
    await addProductToCart(page, "handloom-cushion-cover", { option: "50 × 50 cm" });
    await addProductToCart(page, "stoneware-coffee-mug");

    await page.goto("/cart");
    await expect(page.getByTestId("cart-line")).toHaveCount(2);
    const mug = page.getByTestId("cart-line").filter({ hasText: "Stoneware Coffee Mug" });
    await mug.getByRole("button", { name: "Increase quantity" }).click();
    await expect(mug.getByTestId("quantity-value")).toHaveText("2");

    // ₹990 + 2×₹590 = ₹2,170 ≥ ₹999 → WELCOME10 applies (10%).
    await page.getByLabel("Coupon code").fill("WELCOME10");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("WELCOME10 applied")).toBeVisible();
    await expect(page.getByTestId("order-total")).toHaveText("₹1,953");

    await page.getByRole("link", { name: /Proceed to checkout/ }).click();
    await fillCheckout(page);
    await page.locator("#pm-cod").click();
    await expect(page.getByTestId("order-total")).toHaveText("₹2,002"); // + ₹49 COD fee
    await page.getByTestId("place-order").click();

    await expect(page.getByText("Thank you! Your order is confirmed.")).toBeVisible();
    await expect(page.getByTestId("order-status")).toHaveText("Confirmed");
    const order = await orderFromUrl(page);
    expect(order).toMatchObject({
      paymentMethod: "COD",
      status: "CONFIRMED",
      totalPaise: 200_200,
      couponCode: "WELCOME10",
    });

    await page.goto("/account/orders");
    await expect(
      page.getByTestId("order-row").filter({ hasText: order.orderNumber }),
    ).toBeVisible();
    await page.getByTestId("order-row").filter({ hasText: order.orderNumber }).click();
    await expect(page.getByTestId("order-number")).toHaveText(order.orderNumber);

    // Customer can cancel before packing; stock is released.
    const before = await db.inventory.findFirstOrThrow({
      where: { variant: { sku: order.items[0]!.sku } },
    });
    await page.getByRole("button", { name: "Cancel order" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel order" }).click();
    await expect(page.getByTestId("order-status")).toHaveText("Cancelled");
    const after = await db.inventory.findFirstOrThrow({
      where: { variant: { sku: order.items[0]!.sku } },
    });
    expect(after.quantityOnHand).toBe(before.quantityOnHand + order.items[0]!.quantity);
  });

  test("guest checkout prevents double submission", async ({ page }) => {
    await addProductToCart(page, "linen-hardcover-notebook");
    await page.goto("/checkout");
    await fillCheckout(page, { email: "double@example.com" });
    await page.locator("#pm-cod").click();
    const button = page.getByTestId("place-order");
    await button.dblclick();
    await expect(page.getByText("Thank you! Your order is confirmed.")).toBeVisible();
    expect(await db.order.count({ where: { email: "double@example.com" } })).toBe(1);
  });
});
