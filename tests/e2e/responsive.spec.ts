import { expect, test } from "@playwright/test";
import { addProductToCart, db, fillCheckout } from "./helpers";

test("mobile navigation and layout", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Dry Fruits" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dry Fruits" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByRole("dialog").getByText("In stock only")).toBeVisible();
});

test("a phone shopper can buy with Cash on Delivery and see the order", async ({ page }) => {
  await addProductToCart(page, "cashews-w320");
  await page.goto("/checkout");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "checkout fits the screen").toBeLessThanOrEqual(0);
  await fillCheckout(page);
  await page.locator("#pm-cod").click();
  await page.getByTestId("place-order").click();
  await page.waitForURL(/\/order\/SHV/);
  await expect(page.getByTestId("order-status")).toHaveText("Confirmed");
  const order = await db.order.findUniqueOrThrow({
    where: { orderNumber: new URL(page.url()).pathname.split("/").pop()! },
  });
  expect(order).toMatchObject({ paymentMethod: "COD", status: "CONFIRMED" });
});

test.afterAll(async () => db.$disconnect());
