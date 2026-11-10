import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ quiet: true });

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const E2E_DB = process.env.DATABASE_URL_E2E;
if (!E2E_DB) throw new Error("DATABASE_URL_E2E must be set to run end-to-end tests");

/** Environment for the app under test: production build, isolated DB, offline payment simulator. */
export const e2eEnv = {
  DATABASE_URL: E2E_DB,
  NEXT_PUBLIC_APP_URL: BASE_URL,
  BETTER_AUTH_URL: BASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-1234",
  PAYMENT_GATEWAY: "mock",
  SHIPPING_PROVIDER: "mock",
  SHIPROCKET_WEBHOOK_TOKEN: "e2e_courier_token",
  // Webhooks and emails are processed by background jobs; run them inside the test server.
  JOB_RUNNER: "inline",
  E2E_TEST_MODE: "true",
  // The dev outbox stands in for email here; new accounts must still confirm the emailed code.
  REQUIRE_EMAIL_VERIFICATION: "true",
  RAZORPAY_KEY_ID: "rzp_test_e2e",
  RAZORPAY_KEY_SECRET: "e2e_key_secret",
  RAZORPAY_WEBHOOK_SECRET: "e2e_webhook_secret",
  AUTH_RATE_LIMIT: "off",
  APP_RATE_LIMIT: "off",
  STORAGE_LOCAL_DIR: "./storage/e2e-uploads",
  SEED_DEMO_ORDERS: "false",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /responsive\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI && process.env.E2E_REUSE_SERVER === "1",
    env: { ...process.env, ...e2eEnv } as Record<string, string>,
    stdout: "pipe",
  },
});
