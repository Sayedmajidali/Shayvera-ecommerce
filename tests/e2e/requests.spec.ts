import { expect, test, type Page } from "@playwright/test";
import { ADMIN, addProductToCart, db, fillCheckout, login, register } from "./helpers";

async function placeCodOrder(page: Page) {
  await addProductToCart(page, "cashews-w320");
  await page.goto("/checkout");
  await fillCheckout(page);
  await page.locator("#pm-cod").click();
  await page.getByTestId("place-order").click();
  await page.waitForURL(/\/order\/SHV/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

test.describe("cancellation and return requests", () => {
  test.afterAll(async () => db.$disconnect());

  test("staff approve a customer's cancellation; the hold is released", async ({
    page,
    browser,
  }) => {
    await register(page, "Cancel Requester");
    const orderNumber = await placeCodOrder(page);
    await page.getByRole("button", { name: "Request cancellation" }).click();
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByTestId("order-status")).toHaveText("Cancellation requested");

    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await login(admin, ADMIN, "/admin/requests");
    await admin
      .getByTestId("request-row")
      .filter({ hasText: orderNumber })
      .getByRole("link")
      .click();
    await admin.getByRole("button", { name: "Approve cancellation" }).click();
    await expect(admin.getByText("Order cancelled", { exact: true })).toBeVisible();
    await ctx.close();

    await page.reload();
    await expect(page.getByTestId("order-status")).toHaveText("Cancelled");
    const order = await db.order.findUniqueOrThrow({
      where: { orderNumber },
      include: { reservations: true },
    });
    expect(order.reservations.every((r) => r.status === "RELEASED")).toBe(true);
  });

  test("customer returns a delivered item; staff record it without restocking, refund it, and a credit note is issued", async ({
    page,
    browser,
  }) => {
    await register(page, "Return Requester");
    const orderNumber = await placeCodOrder(page);
    // Fast-forward fulfilment (shipping UI is covered elsewhere).
    await db.order.update({
      where: { orderNumber },
      // COD collected on delivery.
      data: {
        status: "DELIVERED",
        deliveredAt: new Date(),
        shippedAt: new Date(),
        paymentStatus: "PAID",
      },
    });
    await page.reload();
    await page.getByRole("button", { name: "Request a return" }).click();
    await page.getByRole("checkbox").first().check();
    await page.getByLabel("What went wrong?").fill("The pouch arrived torn");
    await page.getByRole("button", { name: "Send return request" }).click();
    await expect(page.getByTestId("order-status")).toHaveText("Return requested");

    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    const order = await db.order.findUniqueOrThrow({ where: { orderNumber } });
    await login(admin, ADMIN, `/admin/orders/${order.id}`);
    await admin.getByRole("button", { name: "Generate invoice" }).click();
    await expect(admin.getByText("Invoice issued")).toBeVisible();
    const panel = admin.getByTestId("order-requests");
    await expect(panel).toContainText("The pouch arrived torn");
    await panel.getByRole("button", { name: "Approve return" }).click();
    await expect(admin.getByText("Return approved", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Mark items received" }).click();
    await admin.getByRole("button", { name: "Save receipt" }).click();
    await expect(admin.getByText("Return recorded")).toBeVisible();

    // Refund the received item at the price paid (COD → recorded as a manual refund).
    await panel.getByRole("button", { name: "Refund return" }).click();
    const dialog = admin.getByRole("dialog");
    await expect(dialog.getByLabel("Amount (₹)")).not.toHaveValue("");
    await dialog.getByRole("button", { name: /^Refund ₹/ }).click();
    await expect(admin.getByText("Refund started")).toBeVisible();
    await expect(panel.getByTestId("return-refund")).toContainText("Processed");
    await ctx.close();

    await page.reload();
    await expect(page.getByTestId("order-status")).toHaveText(/Returned|Refunded/);
    const refunds = page.getByTestId("refunds");
    await expect(refunds).toContainText("Refunded");
    const creditLink = refunds.getByRole("link", { name: /Credit note CN/ });
    await expect(creditLink).toBeVisible();
    const href = await creditLink.getAttribute("href");
    await page.goto(href!);
    await expect(page.getByTestId("credit-note-number")).toHaveText(/^CN\d{4}\/\d{5}$/);
    expect(
      await db.inventoryTransaction.count({ where: { orderId: order.id, reason: "RETURN" } }),
    ).toBe(0);
  });
});
