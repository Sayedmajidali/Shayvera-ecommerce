import { expect, test } from "@playwright/test";
import { loginWithPhone } from "./helpers";

test.describe("mobile number + OTP sign-in", () => {
  test("a new customer signs up with an SMS code and sets their name", async ({ page }) => {
    await loginWithPhone(page, "91234 56789");
    await expect(page.getByText("What should we call you?")).toBeVisible();
    await page.getByLabel("Full name").fill("Ravi Kumar");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/account/);

    await expect(page.getByText("+91 91234 56789")).toBeVisible();
    await expect(page.getByText(/verified — you can sign in with an SMS code/)).toBeVisible();
    await expect(page.getByLabel("Full name")).toHaveValue("Ravi Kumar");
    // Phone-only accounts have no password to change.
    await expect(page.getByText("Changing your password signs you out")).toHaveCount(0);
  });

  test("an existing customer signs straight in", async ({ page }) => {
    await loginWithPhone(page, "98450 12345", "/account/orders");
    await page.waitForURL(/\/account\/orders/);
    await page.goto("/account");
    await expect(page.getByLabel("Full name")).toHaveValue("Ananya Iyer");
  });

  test("a wrong code is rejected with a clear message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Mobile number").fill("9000012345");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Verify & continue" }).click();
    await expect(page.getByText(/code is incorrect|expired|Request a new/)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/Resend code in \d+s/)).toBeVisible();
  });

  test("an invalid number is caught before any SMS is sent", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Mobile number").fill("12345");
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText("Enter a valid 10-digit Indian mobile number.")).toBeVisible();
  });
});
