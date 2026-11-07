import { expect, test } from "@playwright/test";
import { ADMIN, db, login } from "./helpers";

test.describe("admin reports and operations", () => {
  test.afterAll(async () => db.$disconnect());

  test("reports show real figures and export a CSV", async ({ page }) => {
    await login(page, ADMIN, "/admin/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    await page.getByRole("link", { name: "Financial year" }).click();
    await expect(page).toHaveURL(/from=\d{4}-04-01/);
    await expect(page.getByTestId("report-tiles")).toContainText("Gross sales");
    await expect(page.getByTestId("gst-summary")).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "CSV" }).first().click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^shayvera-daily-sales-.*\.csv$/);
    const text = await (await file.createReadStream()).toArray();
    expect(Buffer.concat(text).toString("utf8")).toContain("Date,Orders,Sales (INR)");
  });

  test("invoices, background jobs and dashboard alerts", async ({ page }) => {
    // A dead job appears on the dashboard and can be retried from Background jobs.
    const job = await db.job.create({
      data: { type: "e2e.noop", status: "DEAD", attempts: 8, lastError: "E2E simulated failure" },
    });
    await login(page, ADMIN, "/admin");
    await expect(page.getByTestId("ops-alerts")).toContainText("background jobs out of retries");

    await page.goto("/admin/jobs?status=DEAD");
    const row = page.getByTestId("job-row").filter({ hasText: "e2e.noop" });
    await expect(row).toContainText("E2E simulated failure");
    await row.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Queued for processing")).toBeVisible();
    // The retry is recorded (the worker may then fail this unknown job type again).
    await expect
      .poll(() => db.adminAuditLog.count({ where: { action: "job.retry", entityId: job.id } }))
      .toBe(1);
    await db.job.delete({ where: { id: job.id } }).catch(() => undefined);

    await page.goto("/admin/invoices");
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Place of supply" })).toBeVisible();
  });
});
