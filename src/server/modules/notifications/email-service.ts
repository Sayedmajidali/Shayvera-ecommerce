import { db } from "@/server/platform/db";
import { logger } from "@/server/platform/logger";

export type EmailMessage = {
  to: string;
  subject: string;
  template: string;
  text: string;
  html?: string;
};

/**
 * Email delivery abstraction. In this local-first build, every message is persisted to the
 * OutboundEmail table (viewable in the admin "Emails" page / Prisma Studio) and a redacted
 * line is logged. A production provider (SES, Resend, Postmark…) implements `deliver`.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  try {
    await db.outboundEmail.create({ data: { ...message, status: "SENT_DEV" } });
    logger.info("Email queued (dev outbox)", {
      to: maskEmail(message.to),
      template: message.template,
    });
  } catch (error) {
    // Email failures must never break the business operation that triggered them.
    logger.error("Failed to record outbound email", { template: message.template, error });
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
