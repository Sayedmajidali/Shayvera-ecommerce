import { expect, test } from "@playwright/test";
import { addProductToCart, db, fillCheckout, orderFromUrl, sendWebhook } from "./helpers";

async function startOnlineCheckout(
  page: import("@playwright/test").Page,
  slug = "california-almonds",
) {
  await addProductToCart(page, slug);
  await page.goto("/checkout");
  await fillCheckout(page);
  await page.locator("#pm-online").click();
  await page.getByTestId("place-order").click();
  const dialog = page.getByRole("dialog", { name: "Test payment" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Razorpay payments (test-mode simulator)", () => {
  test("successful payment confirms the order", async ({ page }) => {
    const dialog = await startOnlineCheckout(page);
    await dialog.getByRole("button", { name: /^Pay/ }).click();
    await expect(page.getByText("Thank you! Your order is confirmed.")).toBeVisible();
    const order = await orderFromUrl(page);
    expect(order).toMatchObject({ status: "CONFIRMED", paymentStatus: "PAID" });
    expect(order.payments[0]).toMatchObject({ status: "CAPTURED" });
  });

  test("failed payment keeps the order pending and can be retried", async ({ page }) => {
    const dialog = await startOnlineCheckout(page);
    await dialog.getByRole("button", { name: "Simulate failure" }).click();
    await expect(page.getByText("Your payment didn’t go through")).toBeVisible();
    let order = await orderFromUrl(page);
    expect(order).toMatchObject({ status: "PENDING", paymentStatus: "FAILED" });

    await page.getByRole("button", { name: "Complete payment" }).click();
    await page
      .getByRole("dialog", { name: "Test payment" })
      .getByRole("button", { name: /^Pay/ })
      .click();
    await expect(page.getByTestId("order-status")).toHaveText("Confirmed");
    order = await orderFromUrl(page);
    expect(order.paymentStatus).toBe("PAID");
    expect(order.payments).toHaveLength(2);
  });

  test("interrupted payment (modal closed) can be completed later", async ({ page }) => {
    const dialog = await startOnlineCheckout(page);
    await dialog.getByRole("button", { name: "Cancel payment" }).click();
    await expect(page.getByText("We’re waiting for your payment.")).toBeVisible();
    await page.getByRole("button", { name: "Complete payment" }).click();
    await page
      .getByRole("dialog", { name: "Test payment" })
      .getByRole("button", { name: /^Pay/ })
      .click();
    await expect(page.getByTestId("order-status")).toHaveText("Confirmed");
  });

  test("duplicate and delayed webhooks are handled idempotently", async ({ page, request }) => {
    const dialog = await startOnlineCheckout(page);
    await dialog.getByRole("button", { name: "Cancel payment" }).click();
    await expect(page.getByText("We’re waiting for your payment.")).toBeVisible();
    const order = await orderFromUrl(page);
    const rzpOrder = order.payments[0]!.razorpayOrderId!;
    const entity = {
      id: "pay_e2e_delayed1",
      order_id: rzpOrder,
      status: "captured",
      amount: order.totalPaise,
      currency: "INR",
      method: "upi",
    };

    // Delayed: arrives after the browser gave up.
    const first = await sendWebhook(request, "payment.captured", entity, "evt_e2e_dup");
    expect(first.status()).toBe(200);
    const dup = await sendWebhook(request, "payment.captured", entity, "evt_e2e_dup");
    expect(await dup.json()).toMatchObject({ duplicate: true });

    await page.reload();
    await expect(page.getByTestId("order-status")).toHaveText("Confirmed");
    const history = await db.orderStatusHistory.count({
      where: { orderId: order.id, toStatus: "CONFIRMED" },
    });
    expect(history).toBe(1);

    // Invalid signatures are rejected.
    const forged = await request.post("/api/webhooks/razorpay", {
      data: JSON.stringify({ event: "payment.captured", payload: {} }),
      headers: { "content-type": "application/json", "x-razorpay-signature": "deadbeef" },
    });
    expect(forged.status()).toBe(403);
  });
});
