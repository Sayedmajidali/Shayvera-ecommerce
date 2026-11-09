import "server-only";
import { z } from "zod";

const boolish = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
    PAYMENT_GATEWAY: z.enum(["razorpay", "mock"]).default("razorpay"),
    RAZORPAY_KEY_ID: z.string().default(""),
    RAZORPAY_KEY_SECRET: z.string().default(""),
    RAZORPAY_WEBHOOK_SECRET: z.string().default(""),
    /** Previous webhook secret, accepted during rotation (remove once Razorpay retries have drained). */
    RAZORPAY_WEBHOOK_SECRET_PREVIOUS: z.string().default(""),
    PAYMENT_EXPIRY_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(30),
    EMAIL_PROVIDER: z.enum(["dev-outbox", "smtp"]).default("dev-outbox"),
    SMTP_URL: z.string().default(""),
    EMAIL_FROM: z.string().default(""),
    EMAIL_REPLY_TO: z.string().default(""),
    /** dev-outbox (records + prints codes; phone sign-in disabled in production) or msg91. */
    SMS_PROVIDER: z.enum(["dev-outbox", "msg91"]).default("dev-outbox"),
    MSG91_AUTH_KEY: z.string().default(""),
    MSG91_OTP_TEMPLATE_ID: z.string().default(""),
    MSG91_OTP_VAR: z.string().default("otp"),
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    S3_ENDPOINT: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: z.string().default(""),
    S3_ACCESS_KEY_ID: z.string().default(""),
    S3_SECRET_ACCESS_KEY: z.string().default(""),
    STORAGE_LOCAL_DIR: z.string().default("./storage/uploads"),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024)
      .default(5 * 1024 * 1024),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    E2E_TEST_MODE: boolish.default(false),
    /**
     * Where background jobs run: "worker" (separate `npm run worker` process, production default),
     * "inline" (polled inside the web server, development default) or "off".
     */
    JOB_RUNNER: z.enum(["worker", "inline", "off"]).optional(),
    /** shiprocket (real API), mock (offline simulator, dev/test) or manual (staff enter AWB). */
    SHIPPING_PROVIDER: z.enum(["shiprocket", "mock", "manual"]).optional(),
    SHIPROCKET_API_EMAIL: z.string().default(""),
    SHIPROCKET_API_PASSWORD: z.string().default(""),
    SHIPROCKET_BASE_URL: z.url().default("https://apiv2.shiprocket.in/v1/external"),
    SHIPROCKET_WEBHOOK_TOKEN: z.string().default(""),
    SHIPPING_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
    RAZORPAY_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
    /** Optional: error events are POSTed here as JSON (alert relay / error-tracking ingest). */
    MONITORING_WEBHOOK_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
    /** API requests slower than this are logged as warnings. */
    SLOW_REQUEST_MS: z.coerce.number().int().min(100).max(60_000).default(1500),
  })
  .superRefine((v, ctx) => {
    if (v.EMAIL_PROVIDER === "smtp" && (!v.SMTP_URL || !v.EMAIL_FROM))
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_URL"],
        message: "EMAIL_PROVIDER=smtp needs SMTP_URL and EMAIL_FROM",
      });
    if (v.SMS_PROVIDER === "msg91" && (!v.MSG91_AUTH_KEY || !v.MSG91_OTP_TEMPLATE_ID))
      ctx.addIssue({
        code: "custom",
        path: ["MSG91_AUTH_KEY"],
        message: "SMS_PROVIDER=msg91 needs MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID",
      });
    if (v.STORAGE_DRIVER === "s3")
      for (const k of [
        "S3_ENDPOINT",
        "S3_BUCKET",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
      ] as const)
        if (!v[k])
          ctx.addIssue({
            code: "custom",
            path: [k],
            message: `${k} is required when STORAGE_DRIVER=s3`,
          });
    if (
      v.SHIPPING_PROVIDER === "shiprocket" &&
      (!v.SHIPROCKET_API_EMAIL || !v.SHIPROCKET_API_PASSWORD)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["SHIPROCKET_API_EMAIL"],
        message: "Shiprocket needs SHIPROCKET_API_EMAIL and SHIPROCKET_API_PASSWORD (an API user)",
      });
    }
    if (v.NODE_ENV === "production" && v.SHIPPING_PROVIDER === "mock" && !v.E2E_TEST_MODE) {
      ctx.addIssue({
        code: "custom",
        path: ["SHIPPING_PROVIDER"],
        message: "The mock shipping provider cannot be used in production",
      });
    }
    if (v.NODE_ENV === "production" && v.PAYMENT_GATEWAY === "mock" && !v.E2E_TEST_MODE) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_GATEWAY"],
        message: "The mock payment gateway cannot be used in production",
      });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated server environment. Throws a readable error listing every invalid variable. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}

export function jobRunnerMode(): "worker" | "inline" | "off" {
  const e = env();
  return (
    e.JOB_RUNNER ??
    (e.NODE_ENV === "development" ? "inline" : e.NODE_ENV === "test" ? "off" : "worker")
  );
}

/** Development/test default to the offline simulator; production defaults to manual shipping. */
export function shippingProviderName(): "shiprocket" | "mock" | "manual" {
  const e = env();
  return e.SHIPPING_PROVIDER ?? (e.NODE_ENV === "production" ? "manual" : "mock");
}

export function isRazorpayConfigured(): boolean {
  const e = env();
  if (e.PAYMENT_GATEWAY === "mock") return true;
  return Boolean(e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET);
}
