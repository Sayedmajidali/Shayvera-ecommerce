import { expect, test } from "@playwright/test";
import { addProductToCart, db, fillCheckout } from "./helpers";

// The mock courier (SHIPPING_PROVIDER=mock): PINs starting with 9 are not serviceable, 79xxxx is
// prepaid-only, same postal region as the store = 2 days.
test.describe("delivery check at checkout", () => {
  test.beforeAll(async () => {
    await db.storeSettings.update({ where: { id: "default" }, data: { pincode: "560001" } });
  });
  test.afterAll(async () => {
    await db.storeSettings.update({ where: { id: "default" }, data: { pincode: null } });
    await db.$disconnect();
  });

  test("shows the estimate, disables COD where unavailable and blocks unserved PINs", async ({
    page,
  }) => {
    await addProductToCart(page, "cashews-w320");
    await page.goto("/checkout");
    await fillCheckout(page, { pincode: "560034" });
    await expect(page.getByTestId("delivery-note")).toContainText(
      "Delivers to 560034 in about 2 days",
    );
    await expect(page.locator("#pm-cod")).toBeEnabled();

    await page.locator("#ship-pincode").fill("791001");
    await expect(page.getByTestId("delivery-note")).toContainText(
      "Cash on Delivery isn’t available here",
    );
    await expect(page.locator("#pm-cod")).toBeDisabled();
    await expect(page.getByText("Not available for this PIN code")).toBeVisible();

    await page.locator("#ship-pincode").fill("932001");
    await expect(page.getByTestId("delivery-note")).toContainText("we don’t deliver to 932001");
    await expect(page.getByTestId("place-order")).toBeDisabled();

    await page.locator("#ship-pincode").fill("560034");
    await expect(page.getByTestId("place-order")).toBeEnabled();
    await page.locator("#pm-cod").click();
    await page.getByTestId("place-order").click();
    await page.waitForURL(/\/order\/SHV/);
    const orderNumber = new URL(page.url()).pathname.split("/").pop()!;
    expect(await db.order.findUniqueOrThrow({ where: { orderNumber } })).toMatchObject({
      deliveryCheck: "SERVICEABLE",
      deliveryEtaDays: 2,
    });
  });
});
