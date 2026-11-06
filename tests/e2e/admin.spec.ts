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

test.describe("staff & roles", () => {
  test("owner invites a Catalog staff member who only sees catalog sections", async ({
    page,
    browser,
  }) => {
    await login(page, ADMIN, "/admin/staff");
    await expect(page.getByRole("heading", { name: "Staff & roles" })).toBeVisible();
    await expect(page.getByTestId("role-Owner")).toContainText("Everything");

    await page.getByRole("button", { name: "Invite staff" }).click();
    await page.getByLabel("Name").fill("Catalog Person");
    await page.getByLabel("Email").fill("catalog@e2e.test");
    await page.locator("#staff-role").click();
    await page.getByRole("option", { name: "Catalog" }).click();
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByTestId("staff-catalog@e2e.test")).toContainText("Invite pending");

    const email = await db.outboundEmail.findFirstOrThrow({
      where: { to: "catalog@e2e.test", template: "staff-invite" },
    });
    const link = email.text.match(/https?:\/\/\S+reset-password\/\S+/)![0];
    const ctx = await browser.newContext();
    const staffPage = await ctx.newPage();
    await staffPage.goto(new URL(link).pathname + new URL(link).search);
    await expect(staffPage.getByRole("heading", { name: "Set your password" })).toBeVisible();
    await staffPage.getByLabel("New password", { exact: true }).fill("Catalog123!");
    await staffPage.getByLabel("Confirm new password").fill("Catalog123!");
    await staffPage.getByRole("button", { name: "Update password" }).click();
    await staffPage.waitForURL(/\/login/);

    await login(
      staffPage,
      { email: "catalog@e2e.test", password: "Catalog123!" },
      "/admin/products",
    );
    const nav = staffPage.getByRole("navigation", { name: "Admin" }).first();
    await expect(nav.getByRole("link", { name: "Products" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Orders" })).toHaveCount(0);
    await staffPage.goto("/admin/orders");
    await expect(staffPage).toHaveURL(/\/admin\/no-access/);
    await expect(staffPage.getByRole("heading", { name: /don’t have access/ })).toBeVisible();
    await ctx.close();
  });
});

test.describe("specifications and packages", () => {
  test("admin adds a specification and a variant package; the storefront shows the specification", async ({
    page,
  }) => {
    const product = await db.product.findFirstOrThrow({
      where: { slug: "cashews-w320" },
      include: { variants: { orderBy: { sortOrder: "asc" }, take: 1 } },
    });
    await login(page, ADMIN, `/admin/products/${product.id}`);

    const editor = page.getByTestId("attributes-editor");
    await editor.getByRole("button", { name: "Add specification" }).click();
    const n = await editor.getByRole("textbox", { name: /name$/ }).count();
    await editor.getByLabel(`Specification ${n} name`).fill("Grade");
    await editor.getByLabel(`Specification ${n} value`).fill("W320 whole");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Product saved")).toBeVisible();

    const sku = product.variants[0]!.sku;
    await page.getByRole("button", { name: `Edit ${sku}` }).click();
    await page.getByLabel("Packed weight (g)").fill("290");
    await page.getByLabel("Length (mm)").fill("200");
    await page.getByLabel("Breadth (mm)").fill("140");
    await page.getByLabel("Height (mm)").fill("50");
    await page.getByRole("button", { name: "Save variant" }).click();
    await expect(page.getByText("Variant saved")).toBeVisible();
    await expect
      .poll(async () => (await db.productVariant.findUniqueOrThrow({ where: { sku } })).weightGrams)
      .toBe(290);

    await page.goto("/product/cashews-w320");
    const specs = page.getByTestId("product-specifications");
    await expect(specs.getByRole("row", { name: /Grade\s+W320 whole/ })).toBeVisible();
  });
});
