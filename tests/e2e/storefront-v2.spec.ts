import { expect, test } from "@playwright/test";
import { addProductToCart, db, fillCheckout, register } from "./helpers";

test.describe("wishlist, buy now and tracking", () => {
  test("guests are asked to sign in; customers save and remove products", async ({ page }) => {
    await page.goto("/product/cashews-w320");
    await page
      .getByRole("button", { name: /^Save Cashews W320.* to wishlist$/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login\?next=%2Fproduct%2Fcashews-w320/);

    await register(page, "Wish Lister");
    await page.goto("/product/cashews-w320");
    const save = page.getByRole("button", { name: /^Save Cashews W320.* to wishlist$/ }).first();
    await save.click();
    await expect(page.getByText("Saved to wishlist")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Remove Cashews W320.* from wishlist$/ }).first(),
    ).toHaveAttribute("aria-pressed", "true");

    await page.goto("/account/wishlist");
    const grid = page.getByTestId("wishlist-grid");
    await expect(grid.getByRole("link", { name: /Cashews W320/ }).first()).toBeVisible();
    await grid.getByRole("button", { name: /^Remove Cashews W320.* from wishlist$/ }).click();
    await expect(page.getByText("Your wishlist is empty.")).toBeVisible();
  });

  test("buy now checks out one item and leaves the cart as it was", async ({ page }) => {
    await addProductToCart(page, "california-almonds", { option: "1 kg" });
    await page.goto("/product/cashews-w320");
    await page.getByRole("button", { name: "Increase quantity" }).click();
    await page.getByRole("button", { name: "Buy now" }).click();
    await expect(page).toHaveURL(/\/checkout\?buy=.+&qty=2/);
    await expect(page.getByText("Buying just this item — your cart is unchanged.")).toBeVisible();

    await fillCheckout(page);
    await page.locator("#pm-cod").click();
    await page.getByTestId("place-order").click();
    await page.waitForURL(/\/order\/SHV/);
    const orderNumber = new URL(page.url()).pathname.split("/").pop()!;
    const order = await db.order.findUniqueOrThrow({
      where: { orderNumber },
      include: { items: true },
    });
    expect(order.items).toHaveLength(1);
    expect(order.items[0]!.productName).toContain("Cashews W320");
    expect(order.items[0]!.quantity).toBe(2);

    await page.goto("/cart");
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
    await expect(page.getByTestId("cart-line")).toContainText("California Almonds");
  });

  test("tracks an order by number and phone without exposing the address", async ({ page }) => {
    const order = await db.order.findFirstOrThrow({
      where: { status: { not: "PENDING" } },
      orderBy: { placedAt: "desc" },
    });
    await page.goto("/track");
    await page.getByLabel("Order number").fill(order.orderNumber);
    await page.getByLabel("Email or mobile number").fill("00000");
    await page.getByRole("button", { name: "Track order" }).click();
    await expect(page.getByText(/couldn’t find an order/)).toBeVisible();

    await page.getByLabel("Email or mobile number").fill(order.phone);
    await page.getByRole("button", { name: "Track order" }).click();
    await page.waitForURL(new RegExp(`/track/${order.orderNumber}\\?k=`));
    await expect(page.getByTestId("order-number")).toHaveText(order.orderNumber);
    await expect(page.getByTestId("order-timeline")).toBeVisible();
    const address = order.shippingAddress as { line1: string };
    await expect(page.getByText(address.line1)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /cancel/i })).toHaveCount(0);
  });

  test("product page shows a specifications table", async ({ page }) => {
    await page.goto("/product/cashews-w320");
    const specs = page.getByTestId("product-specifications");
    await expect(specs.getByRole("rowheader", { name: "Country of origin" })).toBeVisible();
    await expect(specs.getByRole("rowheader", { name: "Food type" })).toBeVisible();
  });
});

test("account wishlist page is protected", async ({ page }) => {
  await page.goto("/account/wishlist");
  await expect(page).toHaveURL(/\/login/);
});

test.afterAll(async () => {
  await db.$disconnect();
});
