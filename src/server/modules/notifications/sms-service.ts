import "server-only";
import { db } from "@/server/platform/db";
import { httpJson, HttpError } from "@/server/platform/http";
import { logger } from "@/server/platform/logger";

/**
 * SMS provider abstraction, selected with SMS_PROVIDER:
 * - `dev-outbox` (default): the message is stored in OutboundSms and printed to the server console.
 *   Nothing leaves the machine. Refused in production (phone sign-in is then disabled) unless
 *   E2E_TEST_MODE is set.
 * - `msg91`: MSG91 Flow API (India, DLT-compliant). Needs MSG91_AUTH_KEY and a DLT-approved
 *   template id (MSG91_OTP_TEMPLATE_ID) whose variable is named by MSG91_OTP_VAR (default "otp").
 *   OTP codes are never stored or logged with this provider.
 */
export type SmsMessage = {
  /** E.164, e.g. +919845012345. */
  to: string;
  template: "login-otp";
  /** Template variables. */
  vars: { otp: string };
};

export interface SmsProvider {
  readonly name: "dev-outbox" | "msg91";
  send(message: SmsMessage): Promise<void>;
}

export class SmsDeliveryError extends Error {
  override name = "SmsDeliveryError";
}

function renderText(m: SmsMessage): string {
  return `${m.vars.otp} is your Shayvera Foods sign-in code. It expires in 5 minutes. Do not share it with anyone.`;
}

const devOutbox: SmsProvider = {
  name: "dev-outbox",
  async send(message) {
    const body = renderText(message);
    await db.outboundSms.create({
      data: {
        to: message.to,
        template: message.template,
        body,
        provider: "dev-outbox",
        status: "SENT_DEV",
      },
    });
    // Development only: printed so a developer can sign in without a real SMS gateway.
    if (process.env.NODE_ENV !== "production" || process.env.E2E_TEST_MODE === "true") {
      console.info(`\n[dev-sms] To ${message.to}: ${body}\n`);
    }
  },
};

export function msg91Provider(fetchImpl: typeof fetch = fetch): SmsProvider {
  const authKey = process.env.MSG91_AUTH_KEY ?? "";
  const templateId = process.env.MSG91_OTP_TEMPLATE_ID ?? "";
  const otpVar = process.env.MSG91_OTP_VAR || "otp";
  const baseUrl = process.env.MSG91_BASE_URL || "https://control.msg91.com/api/v5";
  if (!authKey || !templateId) {
    throw new SmsDeliveryError("SMS_PROVIDER=msg91 needs MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID");
  }
  return {
    name: "msg91",
    async send(message) {
      let res: { type?: string; message?: string } | null;
      try {
        res = await httpJson<{ type?: string; message?: string } | null>(
          {
            method: "POST",
            url: `${baseUrl}/flow`,
            headers: { authkey: authKey },
            json: {
              template_id: templateId,
              short_url: "0",
              recipients: [{ mobiles: message.to.replace(/^\+/, ""), [otpVar]: message.vars.otp }],
            },
            // A resend is a new code, so a blind retry could deliver two different codes.
            idempotent: false,
            provider: "msg91",
            operation: "send-otp",
          },
          fetchImpl,
        );
      } catch (error) {
        throw new SmsDeliveryError(
          error instanceof HttpError ? error.message : "Could not reach the SMS provider",
        );
      }
      if (res && typeof res === "object" && res.type === "error") {
        throw new SmsDeliveryError(`msg91 rejected the message: ${res.message ?? "unknown error"}`);
      }
      // Record that a message went out — without the code.
      await db.outboundSms
        .create({
          data: {
            to: message.to,
            template: message.template,
            body: "[redacted: one-time code]",
            provider: "msg91",
            status: "SENT",
          },
        })
        .catch((error) => logger.warn("Could not record sent SMS", { error }));
    },
  };
}

export function smsProviderName(): "dev-outbox" | "msg91" {
  return process.env.SMS_PROVIDER === "msg91" ? "msg91" : "dev-outbox";
}

/** Phone OTP sign-in needs a real SMS gateway in production (or the E2E test mode). */
export function isPhoneOtpEnabled(): boolean {
  if (smsProviderName() === "msg91") return true;
  return process.env.NODE_ENV !== "production" || process.env.E2E_TEST_MODE === "true";
}

let cached: SmsProvider | undefined;

export function smsProvider(): SmsProvider {
  if (smsProviderName() === "dev-outbox") return devOutbox;
  return (cached ??= msg91Provider());
}

export async function sendSms(message: SmsMessage): Promise<void> {
  const provider = smsProvider();
  await provider.send(message);
  logger.info("SMS sent", {
    provider: provider.name,
    template: message.template,
    phone: message.to,
  });
}
