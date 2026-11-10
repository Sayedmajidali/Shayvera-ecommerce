import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { ADMIN, db, login } from "./helpers";

const png = async (width: number, height: number, color: string) => ({
  name: "upload.png",
  mimeType: "image/png",
  buffer: await sharp({ create: { width, height, channels: 4, background: color } })
    .png()
    .toBuffer(),
});

test.describe.configure({ mode: "serial" });

test("admin replaces the logo; the storefront shows it; reset restores the built-in logo", async ({
  page,
  browser,
}) => {
  await login(page, ADMIN, "/admin/site-images");
  const card = page.getByTestId("slot-logo");
  await card.getByLabel("Upload Logo").setInputFiles(await png(600, 150, "#cc6824"));
  await expect(page.getByText("Logo updated")).toBeVisible();
  await expect(card.getByText("Custom")).toBeVisible();

  const shopper = await (await browser.newContext()).newPage();
  await shopper.goto("/");
  const logo = shopper.getByRole("banner").getByRole("link", { name: "Shayvera Food home" });
  await expect(logo.locator("img")).toHaveCount(1); // uploaded image replaces mark + wordmark
  await expect(logo.locator("img")).toHaveAttribute("src", /branding/);

  await card.getByRole("button", { name: "Reset to default" }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByText("Logo reset to default")).toBeVisible();
  await shopper.reload();
  await expect(logo.locator("img")).toHaveCount(2);
  await shopper.context().close();
});

test("admin uploads a category image from the category editor", async ({ page }) => {
  await login(page, ADMIN, "/admin/categories");
  await page.getByRole("button", { name: "Edit Nuts" }).click();
  const box = page.getByTestId("category-image");
  await box.getByLabel("Upload image for Nuts").setInputFiles(await png(800, 1000, "#0c764e"));
  await expect(page.getByText("Category image updated")).toBeVisible();
  const cat = await db.category.findFirstOrThrow({ where: { name: "Nuts" } });
  expect(cat.imageUrl).toMatch(/^\/media\/categories\/.+\.webp$/);
});
