import { expect, test } from "@playwright/test";

test("mobile navigation and layout", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Kitchen & Dining" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Kitchen & Dining" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByRole("dialog").getByText("In stock only")).toBeVisible();
});
