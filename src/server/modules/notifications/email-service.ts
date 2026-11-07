import "server-only";
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
 * Email provider abstraction. The only provider in this build is the development outbox: each
 * message is stored in the OutboundEmail table (admin → Emails) and nothing leaves the server.
 * A real provider (SES, Resend, Postmark…) implements `EmailProvider` and is selected here.
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

export function emailProvider(): EmailProvider {
  return devOutbox;
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
