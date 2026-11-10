/**
 * Sends one test email through the configured provider (EMAIL_PROVIDER / SMTP_URL / EMAIL_FROM), so the
 * SMTP login, sender address and delivery can be checked before customers rely on it.
 *
 *   npm run email:test -- --to you@example.com
 *
 * With EMAIL_PROVIDER=dev-outbox the message is only stored (Admin → Messages & emails). SMTP errors are
 * printed with the server's reply (never the password).
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { db } from "../src/server/platform/db";
import { emailProvider } from "../src/server/modules/notifications/email-service";

async function main() {
  const { values } = parseArgs({ options: { to: { type: "string" } } });
  const to = values.to?.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error("Usage: npm run email:test -- --to you@example.com");
  }
  const provider = emailProvider();
  const smtpHost = process.env.SMTP_URL ? safeHost(process.env.SMTP_URL) : "-";
  console.log(
    `Provider: ${provider.name}${provider.name === "smtp" ? ` (${smtpHost})` : ""}, from: ${process.env.EMAIL_FROM || "-"}`,
  );
  const sentAt = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const result = await provider.send({
    to,
    subject: "Shayvera test email",
    template: "test",
    text: `This is a test email from your Shayvera store, sent ${sentAt} IST. If you can read this, order emails will be delivered.`,
    html: `<p>This is a test email from your Shayvera store, sent ${sentAt} IST.</p><p>If you can read this, order emails will be delivered.</p>`,
  });
  console.log(
    provider.name === "smtp"
      ? `Sent to ${to} (message id ${result.messageId ?? "-"}). Check the inbox and the spam folder.`
      : "EMAIL_PROVIDER is dev-outbox: nothing was sent; the message is in Admin → Messages & emails.",
  );
}

/** Host and port of an SMTP URL, without the username or password. */
function safeHost(url: string) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}:${u.port || (u.protocol === "smtps:" ? 465 : 587)}`;
  } catch {
    return "invalid SMTP_URL";
  }
}

main()
  .catch((error) => {
    const e = error as {
      message?: string;
      code?: string;
      responseCode?: number;
      response?: string;
    };
    console.error(
      `Email test failed: ${e.message ?? String(error)}${e.code ? ` [${e.code}]` : ""}${
        e.responseCode ? ` (server replied ${e.responseCode}: ${e.response ?? ""})` : ""
      }`,
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
