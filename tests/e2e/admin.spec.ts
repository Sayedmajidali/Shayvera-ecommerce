import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { ADMIN, CUSTOMER, addProductToCart, db, fillCheckout, login } from "./helpers";

test.describe("admin dashboard", () => {
  test.beforeEach(async ({ page }) => login(page, ADMIN, "/admin"));

  test("views analytics", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Gross sales", { exact: true })).toBeVisible();
    await expect(page.getByText("Daily gross sales")).toBeVisible();
    await page.getByRole("button", { name: "View as table" }).click();
    await expect(page.getByRole("columnheader", { name: "Orders" })).toBeVisible();
  });

  test("creates a product, uploads an image and updates stock", async ({ page }) => {
    const dir = path.resolve("test-results/fixtures");
    mkdirSync(dir, { recursive: true });
    const img = path.join(dir, "product.png");
    writeFileSync(
      img,
      await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#b5643f" } })
        .png()
        .toBuffer(),
    );
    const bad = path.join(dir, "fake.png");
    writeFileSync(bad, "<script>alert(1)</script>".repeat(20));

    await page.goto("/admin/products/new");
    await page.getByLabel("Name", { exact: true }).fill("E2E Jaggery Powder");
    await page
      .getByLabel("Description", { exact: true })
      .fill("Stone-ground jaggery powder created by the E2E suite.");
    await page.locator("#p-status").click();
    await page.getByRole("option", { name: "Active (visible)" }).click();
    await page.locator("#v-0-sku").fill("E2E-JAGGERY-01");
    await page.locator("#v-0-price").fill("499");
    await page.locator("#v-0-stock").fill("7");
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByRole("heading", { name: "E2E Jaggery Powder" })).toBeVisible();

    await page.getByTestId("image-upload-input").setInputFiles(img);
    await expect(page.getByText("Cover")).toBeVisible();
    await page.getByTestId("image-upload-input").setInputFiles(bad);
    await expect(
      page.getByText(/fake\.png: The file contents are not a valid image/),
    ).toBeVisible();

    await page.getByRole("button", { name: "Adjust stock for E2E-JAGGERY-01" }).click();
    await page.getByLabel("Change (+/−)").fill("5");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("Stock updated")).toBeVisible();
    const inv = await db.inventory.findFirstOrThrow({
      where: { variant: { sku: "E2E-JAGGERY-01" } },
    });
    expect(inv.quantityOnHand).toBe(12);

    await page.goto("/product/e2e-jaggery-powder");
    await expect(page.getByRole("heading", { level: 1, name: "E2E Jaggery Powder" })).toBeVisible();
  });

  test("creates a coupon", async ({ page }) => {
    await page.goto("/admin/coupons");
    await page.getByRole("button", { name: "New coupon" }).click();
    await page.getByLabel("Code").fill("E2ESAVE");
    await page.getByLabel("Percent (%)").fill("15");
    await page.getByRole("button", { name: "Save coupon" }).click();
    await expect(page.getByRole("cell", { name: "E2ESAVE", exact: true })).toBeVisible();
    expect(await db.coupon.findUnique({ where: { code: "E2ESAVE" } })).toMatchObject({
      type: "PERCENTAGE",
      value: 1500,
    });
  });

  test("views orders and updates an order status", async ({ page }) => {
    // Place a COD order (admins can shop too) so this test is independent of other specs.
    await addProductToCart(page, "chole-masala");
    await page.goto("/checkout");
    await fillCheckout(page, { email: "admin-flow@example.com" });
    await page.locator("#pm-cod").click();
    await page.getByTestId("place-order").click();
    await expect(page.getByText("Thank you! Your order is confirmed.")).toBeVisible();
    const order = await db.order.findFirst({
      where: { email: "admin-flow@example.com" },
      orderBy: { createdAt: "desc" },
    });
    await page.goto("/admin/orders");
    await page.getByLabel("Order number, email or phone").fill(order!.orderNumber);
    await page.getByLabel("Order number, email or phone").press("Enter");
    await page.getByRole("link", { name: order!.orderNumber }).click();
    await page.locator("#status-to").click();
    await page.getByRole("option", { name: "Processing" }).click();
    await page.getByRole("button", { name: "Update status" }).click();
    await expect(page.getByText("Status updated")).toBeVisible();
    await expect(page.getByText("CONFIRMED → PROCESSING")).toBeVisible();
  });
});

test("customers cannot access the admin dashboard", async ({ page, request }) => {
  await login(page, CUSTOMER);
  await page.goto("/admin");
  await expect(page).not.toHaveURL(/\/admin/);
  const api = await page.request.get("/api/admin/orders");
  expect(api.status()).toBe(403);
  const anon = await request.get("/api/admin/orders");
  expect(anon.status()).toBe(401);
});
