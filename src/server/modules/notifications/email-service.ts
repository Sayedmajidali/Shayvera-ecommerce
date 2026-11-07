import "server-only";
import nodemailer from "nodemailer";
import { db } from "@/server/platform/db";
import { logger } from "@/server/platform/logger";

export type EmailMessage = {
  to: string;
  subject: string;
  template: string;
  text: string;
  html?: string;
};

export type EmailDelivery = { provider: string; messageId: string | null };

/**
 * Email provider abstraction, selected with EMAIL_PROVIDER:
 * - `dev-outbox` (default outside production): stored in OutboundEmail (Admin → Messages & emails);
 *   nothing leaves the server.
 * - `smtp`: any SMTP service (Amazon SES, Zoho, Google Workspace, Brevo, Postmark…) via nodemailer,
 *   configured with SMTP_URL (e.g. smtps://user:pass@email-smtp.ap-south-1.amazonaws.com:465).
 *   Delivered messages are also recorded in OutboundEmail (status SENT) for support visibility.
 */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailDelivery>;
}

const devOutbox: EmailProvider = {
  name: "dev-outbox",
  async send(message) {
    const row = await db.outboundEmail.create({ data: { ...message, status: "SENT_DEV" } });
    return { provider: "dev-outbox", messageId: row.id };
  },
};

let smtp: EmailProvider | undefined;

function smtpProvider(): EmailProvider {
  if (smtp) return smtp;
  const url = process.env.SMTP_URL;
  const from = process.env.EMAIL_FROM;
  if (!url || !from) throw new Error("EMAIL_PROVIDER=smtp needs SMTP_URL and EMAIL_FROM");
  const u = new URL(url);
  const secure = u.protocol === "smtps:";
  const transport = nodemailer.createTransport({
    host: u.hostname,
    port: Number(u.port) || (secure ? 465 : 587),
    secure,
    // STARTTLS is mandatory on smtp:// so credentials never travel in clear — except to a local
    // catcher (Mailpit/MailHog) on the same machine.
    requireTLS: !secure && !["localhost", "127.0.0.1"].includes(u.hostname),
    ignoreTLS: ["localhost", "127.0.0.1"].includes(u.hostname) && !secure,
    auth: u.username
      ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  smtp = {
    name: "smtp",
    async send(message) {
      const info = await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: process.env.EMAIL_REPLY_TO || undefined,
        headers: { "X-Shayvera-Template": message.template },
      });
      // Keep a record (no secrets) so support can see what was sent; failures here never block.
      await db.outboundEmail
        .create({ data: { ...message, status: "SENT" } })
        .catch((error) => logger.warn("Could not record sent email", { error }));
      return { provider: "smtp", messageId: info.messageId ?? null };
    },
  };
  return smtp;
}

export function emailProvider(): EmailProvider {
  return process.env.EMAIL_PROVIDER === "smtp" ? smtpProvider() : devOutbox;
}

/** Test hook: forget the cached SMTP transport (after changing SMTP_URL). */
export function resetEmailProvider() {
  smtp = undefined;
}

/** Delivers an email and throws on failure (used by the notification job, which retries). */
export async function deliverEmail(message: EmailMessage): Promise<EmailDelivery> {
  const result = await emailProvider().send(message);
  logger.info("Email delivered", {
    to: maskEmail(message.to),
    template: message.template,
    provider: result.provider,
  });
  return result;
}

/**
 * Immediate, best-effort send for flows where the user is waiting (password reset, verification).
 * Never throws into the calling flow.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  try {
    await deliverEmail(message);
  } catch (error) {
    logger.error("Failed to send email", { template: message.template, error });
  }
}

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
