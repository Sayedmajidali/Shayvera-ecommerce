import { createServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import {
  deliverEmail,
  emailProvider,
  resetEmailProvider,
} from "@/server/modules/notifications/email-service";

/** Minimal SMTP server (EHLO/AUTH PLAIN/MAIL/RCPT/DATA/QUIT) that records what it receives. */
async function fakeSmtp() {
  const received: { from: string; to: string[]; data: string; auth: string | null }[] = [];
  const server = createServer((sock: Socket) => {
    let mode: "cmd" | "data" = "cmd";
    let cur = { from: "", to: [] as string[], data: "", auth: null as string | null };
    const say = (s: string) => sock.write(`${s}\r\n`);
    say("220 fake.smtp ESMTP");
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx: number;
      while ((idx = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (mode === "data") {
          if (line === ".") {
            received.push(cur);
            cur = { from: "", to: [], data: "", auth: cur.auth };
            mode = "cmd";
            say("250 OK queued");
          } else cur.data += `${line}\n`;
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO")
          sock.write("250-fake.smtp\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (cmd === "AUTH") {
          cur.auth = Buffer.from(line.split(" ")[2] ?? "", "base64").toString("utf8");
          say("235 Authenticated");
        } else if (cmd === "MAIL") {
          cur.from = line;
          say("250 OK");
        } else if (cmd === "RCPT") {
          cur.to.push(line);
          say("250 OK");
        } else if (cmd === "DATA") {
          mode = "data";
          say("354 End with .");
        } else if (cmd === "QUIT") {
          say("221 Bye");
          sock.end();
        } else say("250 OK");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { port: (server.address() as AddressInfo).port, received, close: () => server.close() };
}

afterEach(() => {
  delete process.env.EMAIL_PROVIDER;
  delete process.env.SMTP_URL;
  delete process.env.EMAIL_FROM;
  resetEmailProvider();
});

describe("SMTP email provider", () => {
  it("delivers through SMTP with authentication and records the message", async () => {
    const smtp = await fakeSmtp();
    try {
      process.env.EMAIL_PROVIDER = "smtp";
      process.env.SMTP_URL = `smtp://mailer:p%40ss@127.0.0.1:${smtp.port}`;
      process.env.EMAIL_FROM = "Shayvera Food <orders@shayvera.test>";
      expect(emailProvider().name).toBe("smtp");
      const result = await deliverEmail({
        to: "asha@example.com",
        subject: "Order SHV1 confirmed",
        template: "order-confirmed",
        text: "Thank you for your order!",
        html: "<p>Thank you for your order!</p>",
      });
      expect(result.provider).toBe("smtp");
      expect(smtp.received).toHaveLength(1);
      const m = smtp.received[0]!;
      expect(m.auth).toBe("\u0000mailer\u0000p@ss"); // URL-encoded password decoded
      expect(m.from).toContain("orders@shayvera.test");
      expect(m.to.join()).toContain("asha@example.com");
      expect(m.data).toContain("Subject: Order SHV1 confirmed");
      expect(m.data).toContain("X-Shayvera-Template: order-confirmed");
      const row = await db.outboundEmail.findFirstOrThrow({
        where: { template: "order-confirmed" },
      });
      expect(row.status).toBe("SENT");
    } finally {
      smtp.close();
    }
  });

  it("an unreachable server fails the delivery (the notification job then retries)", async () => {
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_URL = "smtp://127.0.0.1:1";
    process.env.EMAIL_FROM = "orders@shayvera.test";
    await expect(
      deliverEmail({ to: "a@example.com", subject: "x", template: "t", text: "x" }),
    ).rejects.toThrow();
    expect(await db.outboundEmail.count()).toBe(0);
  });

  it("defaults to the development outbox", async () => {
    expect(emailProvider().name).toBe("dev-outbox");
  });
});
