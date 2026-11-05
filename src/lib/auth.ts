import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import { sendEmail, escapeHtml } from "@/server/email/email-service";

const appUrl =
  process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const isProd = process.env.NODE_ENV === "production";

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
    },
  },
  advanced: {
    useSecureCookies: isProd && appUrl.startsWith("https://"),
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await db.user.findUnique({
            where: { id: session.userId },
            select: { status: true },
          });
          if (!user || user.status !== "ACTIVE") {
            throw new APIError("FORBIDDEN", { message: "This account has been disabled." });
          }
        },
      },
    },
  },
  telemetry: { enabled: false },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
