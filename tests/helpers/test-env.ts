import { config } from "dotenv";

/** Loads .env and points DATABASE_URL at the dedicated test database. */
export function loadTestEnv() {
  config({ quiet: true });
  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) throw new Error("DATABASE_URL_TEST must be set to run integration tests");
  if (testUrl === process.env.DATABASE_URL && !testUrl.includes("test")) {
    throw new Error("Refusing to run integration tests against the development database");
  }
  process.env.DATABASE_URL = testUrl;
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.AUTH_RATE_LIMIT = "off";
  process.env.APP_RATE_LIMIT = "off";
  process.env.PAYMENT_GATEWAY = "mock";
  process.env.RAZORPAY_KEY_ID ||= "rzp_test_mockkey000001";
  process.env.RAZORPAY_KEY_SECRET = "test_key_secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.STORAGE_LOCAL_DIR = "./storage/test-uploads";
}
