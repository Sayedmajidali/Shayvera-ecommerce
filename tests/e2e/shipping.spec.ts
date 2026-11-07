import { expect, test } from "@playwright/test";
import { e2eEnv } from "../../playwright.config";
import { ADMIN, addProductToCart, db, fillCheckout, login, register } from "./helpers";

/** "DD MM YYYY HH:mm:ss" in IST, the courier webhook's timestamp format. */
function istStamp(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day} ${p.month} ${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

// Mock courier (SHIPPING_PROVIDER=mock): the real Shiprocket API is not called in tests.
test.describe("courier shipping", () => {
  test.afterAll(async () => db.$disconnect());

  test("staff book a courier; a tracking webhook reaches the customer's order page", async ({
    page,
    browser,
  }) => {
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await login(admin, ADMIN, "/admin/settings");
    const form = admin.getByTestId("pickup-location-form");
    await form.getByLabel("Pickup location name").fill("Primary");
    await form.getByLabel("Contact person").fill("Warehouse Lead");
    await form.getByLabel("Phone").fill("9876543210");
    await form.getByLabel("Email").fill("warehouse@example.com");
    await form.getByLabel("Address line 1").fill("12 Industrial Area");
    await form.getByLabel("City").fill("Bengaluru");
    await form.getByLabel("PIN code").fill("560034");
    await admin.locator("#pl-state").click();
    await admin.getByRole("option", { name: "Karnataka" }).click();
    await form.getByRole("button", { name: "Save pickup location" }).click();
    await expect(admin.getByText("Pickup location saved")).toBeVisible();

    await register(page, "Courier Customer");
    await addProductToCart(page, "cashews-w320");
    await page.goto("/checkout");
    await fillCheckout(page);
    await page.locator("#pm-cod").click();
    await page.getByTestId("place-order").click();
    await page.waitForURL(/\/order\/SHV/);
    const orderNumber = new URL(page.url()).pathname.split("/").pop()!;
    const order = await db.order.findUniqueOrThrow({ where: { orderNumber } });

    await admin.goto(`/admin/orders/${order.id}`);
    await admin.getByRole("button", { name: "Book courier" }).click();
    const dialog = admin.getByRole("dialog");
    await expect(dialog.getByRole("radiogroup", { name: "Courier" })).toBeVisible();
    await dialog.getByRole("button", { name: "Book shipment" }).click();
    await expect(admin.getByText("Booking queued")).toBeVisible();

    // The booking runs as a background job; wait for the AWB.
    await expect
      .poll(
        async () =>
          (await db.shipment.findFirst({ where: { orderId: order.id, isReturn: false } }))
            ?.trackingNumber ?? null,
        { timeout: 30_000 },
      )
      .not.toBeNull();
    await admin.reload();
    const shipment = await db.shipment.findFirstOrThrow({
      where: { orderId: order.id, isReturn: false },
    });
    await expect(admin.getByTestId("awb")).toHaveText(shipment.trackingNumber!);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "READY_TO_SHIP",
    );

    await admin.getByRole("button", { name: "Schedule pickup" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Schedule pickup" }).click();
    await expect(admin.getByText("Pickup scheduled", { exact: true }).first()).toBeVisible();
    await ctx.close();

    // The courier reports the parcel out for delivery.
    const res = await page.request.post("/api/webhooks/courier", {
      headers: { "x-api-key": e2eEnv.SHIPROCKET_WEBHOOK_TOKEN },
      data: {
        awb: shipment.trackingNumber,
        current_status: "OUT FOR DELIVERY",
        shipment_status: "OUT FOR DELIVERY",
        shipment_status_id: 17,
        current_timestamp: istStamp(new Date(Date.now() + 60_000)),
        scans: [],
      },
    });
    expect(res.status()).toBe(200);
    await expect
      .poll(async () => (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, {
        timeout: 30_000,
      })
      .toBe("OUT_FOR_DELIVERY");

    await page.reload();
    await expect(page.getByTestId("order-status")).toHaveText("Out for delivery");
    await expect(page.getByTestId("shipment-status")).toHaveText("Out for delivery");

    // A wrong token is refused.
    const bad = await page.request.post("/api/webhooks/courier", {
      headers: { "x-api-key": "wrong" },
      data: { awb: shipment.trackingNumber, shipment_status_id: 7 },
    });
    expect(bad.status()).toBe(401);
  });
});
