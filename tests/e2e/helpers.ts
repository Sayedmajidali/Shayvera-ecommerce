import { createHmac, randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { e2eEnv } from "../../playwright.config";

export const db = new PrismaClient({ datasourceUrl: e2eEnv.DATABASE_URL });

export const ADMIN = { email: "admin@e2e.test", password: "AdminE2E123!" };
export const CUSTOMER = { email: "customer@shayvera.local", password: "Customer123!" };

/** Sign-in pages default to mobile OTP; switch to the email form when the tabs are shown. */
export async function chooseEmailTab(page: Page) {
  const tab = page.getByRole("tab", { name: "Email & password" });
  if ((await tab.count()) && (await tab.getAttribute("aria-selected")) !== "true")
    await tab.click();
}

/** Signs in with a mobile number, reading the code from the dev SMS outbox. Returns the code. */
export async function loginWithPhone(page: Page, mobile: string, next?: string) {
  await page.goto(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByLabel("Mobile number").fill(mobile);
  const since = new Date();
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  const to = `+91${mobile.replace(/\D/g, "").slice(-10)}`;
  let code = "";
  await expect
    .poll(async () => {
      const sms = await db.outboundSms.findFirst({
        where: { to, createdAt: { gte: new Date(since.getTime() - 2000) } },
        orderBy: { createdAt: "desc" },
      });
      code = /^(\d{6})/.exec(sms?.body ?? "")?.[1] ?? "";
      return code;
    })
    .toMatch(/^\d{6}$/);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify & continue" }).click();
  return code;
}

export async function login(page: Page, who: { email: string; password: string }, next?: string) {
  await page.goto(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await chooseEmailTab(page);
  await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export async function register(page: Page, name: string) {
  const email = `e2e-${randomUUID().slice(0, 8)}@example.com`;
  await page.goto("/register");
  await chooseEmailTab(page);
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Shopper123!");
  const since = new Date(Date.now() - 2000);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("6-digit code").fill(await emailCode(email, "email-verification", since));
  await page.getByRole("button", { name: "Verify & continue" }).click();
  await page.waitForURL(/\/account/);
  return email;
}

/** Reads the latest 6-digit code emailed to `email` (dev outbox). */
export async function emailCode(
  email: string,
  purpose: "email-verification" | "forget-password",
  since: Date,
) {
  let code = "";
  await expect
    .poll(async () => {
      const mail = await db.outboundEmail.findFirst({
        where: { to: email, template: `auth-${purpose}`, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
      });
      code = /Your code: (\d{6})/.exec(mail?.text ?? "")?.[1] ?? "";
      return code;
    })
    .toMatch(/^\d{6}$/);
  return code;
}

export async function addProductToCart(
  page: Page,
  slug: string,
  opts: { option?: string; quantity?: number } = {},
) {
  await page.goto(`/product/${slug}`);
  if (opts.option) await page.getByRole("button", { name: opts.option, exact: true }).click();
  for (let i = 1; i < (opts.quantity ?? 1); i++)
    await page.getByRole("button", { name: "Increase quantity" }).click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to your cart")).toBeVisible();
}

export async function fillCheckout(
  page: Page,
  o: { email?: string; state?: string; pincode?: string } = {},
) {
  const email = page.getByLabel("Email", { exact: true });
  if (o.email || !(await email.inputValue()))
    await email.fill(o.email ?? `guest-${randomUUID().slice(0, 6)}@example.com`);
  await page.getByLabel("Mobile number", { exact: true }).first().fill("9876543210");
  const name = page.locator("#ship-fullName");
  if (await name.isVisible()) {
    await name.fill("E2E Shopper");
    await page.locator("#ship-phone").fill("9876543210");
    await page.locator("#ship-line1").fill("221 MG Road");
    await page.locator("#ship-city").fill("Bengaluru");
    await page.locator("#ship-stateCode").click();
    await page.getByRole("option", { name: o.state ?? "Karnataka" }).click();
    await page.locator("#ship-pincode").fill(o.pincode ?? "560001");
  }
}

export async function orderFromUrl(page: Page) {
  const number = new URL(page.url()).pathname.split("/").pop()!;
  return db.order.findUniqueOrThrow({
    where: { orderNumber: number },
    include: { payments: true, items: true },
  });
}

/** Sends a correctly signed Razorpay webhook to the app under test. */
export async function sendWebhook(
  request: APIRequestContext,
  event: string,
  entity: Record<string, unknown>,
  eventId = `evt_${randomUUID()}`,
) {
  const raw = JSON.stringify({ entity: "event", event, payload: { payment: { entity } } });
  const signature = createHmac("sha256", e2eEnv.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
  return request.post("/api/webhooks/razorpay", {
    data: raw,
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": signature,
      "x-razorpay-event-id": eventId,
    },
  });
}
