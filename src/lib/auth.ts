import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { normalizeIndianPhone, phonePlaceholderEmail } from "@/lib/india";
import { db } from "@/server/platform/db";
import { sendEmail, escapeHtml } from "@/server/modules/notifications/email-service";
import { isPhoneOtpEnabled, sendSms } from "@/server/modules/notifications/sms-service";

const appUrl =
  process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const isProd = process.env.NODE_ENV === "production";

/** Server-side password policy (the UI mirrors it, but the server is authoritative). */
const PASSWORD_PATHS = new Set(["/sign-up/email", "/reset-password", "/change-password"]);
function assertStrongPassword(pw: unknown) {
  if (typeof pw !== "string") return;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw new APIError("BAD_REQUEST", {
      message: "Password must contain at least one letter and one number",
    });
  }
}

/** Phone sign-in ids are Indian mobiles in E.164 form; the UI normalises before sending. */
const E164_INDIAN_MOBILE = /^\+91[6-9]\d{9}$/;

/** Phone-number plugin endpoints Shayvera does not use (customers sign in by OTP, never phone+password). */
const DISABLED_PATHS = new Set([
  "/sign-in/phone-number",
  "/phone-number/request-password-reset",
  "/phone-number/reset-password",
]);

/** Per-number OTP throttle on top of the per-IP rate limit, so one number cannot be SMS-bombed. */
const OTP_RESEND_SECONDS = 30;
const OTP_MAX_PER_HOUR = 5;

async function assertOtpAllowed(phone: unknown) {
  if (!isPhoneOtpEnabled()) {
    throw new APIError("SERVICE_UNAVAILABLE", {
      message: "Sign-in by SMS code is not available right now. Please use email.",
    });
  }
  if (typeof phone !== "string" || !E164_INDIAN_MOBILE.test(phone)) return; // plugin validator rejects
  const now = Date.now();
  const [recent, lastHour] = await Promise.all([
    db.outboundSms.count({
      where: { to: phone, createdAt: { gt: new Date(now - OTP_RESEND_SECONDS * 1000) } },
    }),
    db.outboundSms.count({ where: { to: phone, createdAt: { gt: new Date(now - 3600_000) } } }),
  ]);
  if (recent > 0) {
    throw new APIError("TOO_MANY_REQUESTS", {
      message: `Please wait ${OTP_RESEND_SECONDS} seconds before requesting another code.`,
    });
  }
  if (lastHour >= OTP_MAX_PER_HOUR) {
    throw new APIError("TOO_MANY_REQUESTS", {
      message: "Too many codes requested for this number. Please try again in an hour.",
    });
  }
}

export const auth = betterAuth({
  appName: "Shayvera",
  baseURL: appUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [appUrl, process.env.NEXT_PUBLIC_APP_URL ?? appUrl],
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    // No production email service yet; verification is offered but not required.
    requireEmailVerification: false,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 30,
    sendResetPassword: async ({ user, url }) => {
      // Staff invitations reuse this flow; their callback URL carries `invite=1`.
      const callback = new URL(url).searchParams.get("callbackURL") ?? "";
      if (callback.includes("invite=1")) {
        await sendEmail({
          to: user.email,
          subject: "You’ve been invited to the Shayvera Foods admin",
          template: "staff-invite",
          text: `Hi ${user.name},\n\nYou have been given staff access to the Shayvera Foods store admin. Set your password with the link below. It expires in 30 minutes; if it does, use "Forgot password" on the sign-in page with this email address.\n\n${url}\n\nIf you did not expect this, you can ignore this email.`,
          html: `<p>Hi ${escapeHtml(user.name)},</p><p>You have been given staff access to the Shayvera Foods store admin. Set your password with the link below. It expires in 30 minutes; if it does, use “Forgot password” on the sign-in page with this email address.</p><p><a href="${escapeHtml(url)}">Set your password</a></p><p>If you did not expect this, you can ignore this email.</p>`,
        });
        return;
      }
      await sendEmail({
        to: user.email,
        subject: "Reset your Shayvera password",
        template: "password-reset",
        text: `Hi ${user.name},\n\nUse the link below to reset your password. It expires in 30 minutes.\n\n${url}\n\nIf you didn't request this, you can ignore this email.`,
        html: `<p>Hi ${escapeHtml(user.name)},</p><p>Use the link below to reset your password. It expires in 30 minutes.</p><p><a href="${escapeHtml(url)}">Reset password</a></p><p>If you didn't request this, you can ignore this email.</p>`,
      });
    },
  },
  user: {
    additionalFields: {
      // input:false → cannot be set through sign-up or update-user endpoints.
      role: { type: "string", required: false, defaultValue: "CUSTOMER", input: false },
      status: { type: "string", required: false, defaultValue: "ACTIVE", input: false },
      phone: { type: "string", required: false, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14, // 14 days
    updateAge: 60 * 60 * 24, // refresh expiry daily on activity
    freshAge: 60 * 15,
  },
  rateLimit: {
    enabled: process.env.AUTH_RATE_LIMIT !== "off",
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 300, max: 5 },
      "/reset-password": { window: 300, max: 10 },
      "/phone-number/send-otp": { window: 60, max: 3 },
      "/phone-number/verify": { window: 60, max: 10 },
    },
  },
  advanced: {
    useSecureCookies: isProd && appUrl.startsWith("https://"),
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (DISABLED_PATHS.has(ctx.path)) throw new APIError("NOT_FOUND");
      if (ctx.path === "/phone-number/send-otp") {
        await assertOtpAllowed((ctx.body as { phoneNumber?: unknown } | undefined)?.phoneNumber);
        return;
      }
      if (!PASSWORD_PATHS.has(ctx.path)) return;
      const body = (ctx.body ?? {}) as { password?: unknown; newPassword?: unknown };
      assertStrongPassword(body.password);
      assertStrongPassword(body.newPassword);
    }),
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session, ctx) => {
          const user = await db.user.findUnique({
            where: { id: session.userId },
            select: { status: true, role: true },
          });
          if (!user || user.status !== "ACTIVE") {
            throw new APIError("FORBIDDEN", { message: "This account has been disabled." });
          }
          // Staff always sign in with email + password; an SMS code alone never opens the admin.
          if (user.role === "ADMIN" && ctx?.path === "/phone-number/verify") {
            throw new APIError("FORBIDDEN", {
              message: "Staff accounts sign in with email and password.",
            });
          }
        },
      },
    },
  },
  telemetry: { enabled: false },
  plugins: [
    phoneNumber({
      otpLength: 6,
      expiresIn: 5 * 60,
      allowedAttempts: 3,
      phoneNumberValidator: (p) => E164_INDIAN_MOBILE.test(p),
      sendOTP: async ({ phoneNumber: to, code }) => {
        await sendSms({ to, template: "login-otp", vars: { otp: code } });
      },
      // First successful code for a new number creates the customer account. The email is a
      // non-deliverable placeholder; the customer gives a real email at checkout.
      signUpOnVerification: {
        getTempEmail: (p) => phonePlaceholderEmail(p),
        getTempName: (p) => p,
      },
      callbackOnVerification: async ({ phoneNumber: verified, user }) => {
        // Use the verified number as the delivery contact when none is saved yet.
        await db.user.updateMany({
          where: { id: user.id, phone: null },
          data: { phone: normalizeIndianPhone(verified) },
        });
      },
    }),
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
