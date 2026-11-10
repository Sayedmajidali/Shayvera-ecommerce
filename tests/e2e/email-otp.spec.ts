import { expect, test } from "@playwright/test";
import { chooseEmailTab, emailCode, login, register } from "./helpers";

test.describe("email codes", () => {
  test("a new account confirms its email with a code, then can reset its password with a code", async ({
    page,
  }) => {
    // Sign-up → code step → signed in (helper reads the code from the dev outbox).
    const email = await register(page, "Code Tester");
    await expect(page).toHaveURL(/\/account/);
    await page.context().clearCookies();

    // Forgot password: email → code + new password → sign in with the new password.
    await page.goto("/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill(email);
    const since = new Date(Date.now() - 2000);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByLabel("6-digit code")).toBeVisible();
    await page.getByLabel("6-digit code").fill("000000");
    await page.getByLabel("New password", { exact: true }).fill("Fresh1234!");
    await page.getByLabel("Confirm new password").fill("Fresh1234!");
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /incorrect|expired/i })).toBeVisible();

    await page.getByLabel("6-digit code").fill(await emailCode(email, "forget-password", since));
    await page.getByRole("button", { name: "Reset password" }).click();
    await page.waitForURL(/\/login\?reset=1/);
    await login(page, { email, password: "Fresh1234!" });
    await expect(page).toHaveURL(/\/account/);
  });

  test("signing in before verifying shows the code step instead of an error", async ({ page }) => {
    const email = `e2e-unverified-${Date.now()}@example.com`;
    await page.goto("/register");
    await chooseEmailTab(page);
    await page.getByLabel("Full name").fill("Later Verifier");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill("Shopper123!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByLabel("6-digit code")).toBeVisible();

    // Leave without verifying, then try to sign in with the password.
    await page.goto("/login");
    await chooseEmailTab(page);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill("Shopper123!");
    const since = new Date(Date.now() - 2000);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByLabel("6-digit code")).toBeVisible();
    await page.getByLabel("6-digit code").fill(await emailCode(email, "email-verification", since));
    await page.getByRole("button", { name: "Verify & continue" }).click();
    await page.waitForURL(/\/account/);
  });
});
