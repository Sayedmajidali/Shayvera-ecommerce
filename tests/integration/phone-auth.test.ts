import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import { authRequest, cookieFrom, createAdmin, registerCustomer } from "../helpers/auth";
import { getUserFromHeaders } from "@/server/modules/auth/session";
import { deliverEmail } from "@/server/modules/notifications/email-service";
import { msg91Provider, SmsDeliveryError } from "@/server/modules/notifications/sms-service";
import {
  formatIndianMobile,
  isPlaceholderEmail,
  phonePlaceholderEmail,
  toE164IndianMobile,
} from "@/lib/india";

const PHONE = "+919845012345";

async function sendOtp(phoneNumber: string) {
  return authRequest("/phone-number/send-otp", { phoneNumber });
}

/** Reads the code the dev-outbox provider recorded for this number. */
async function latestCode(phoneNumber: string): Promise<string> {
  const sms = await db.outboundSms.findFirstOrThrow({
    where: { to: phoneNumber },
    orderBy: { createdAt: "desc" },
  });
  const code = /^(\d{6}) is your Shayvera Foods sign-in code/.exec(sms.body)?.[1];
  if (!code) throw new Error(`no code in SMS body: ${sms.body}`);
  return code;
}

async function verify(
  phoneNumber: string,
  code: string,
  extra: Record<string, unknown> = {},
  cookie?: string,
) {
  return authRequest("/phone-number/verify", { phoneNumber, code, ...extra }, cookie);
}

async function signInWithPhone(phoneNumber = PHONE) {
  expect((await sendOtp(phoneNumber)).status).toBe(200);
  const res = await verify(phoneNumber, await latestCode(phoneNumber));
  return { res, cookie: res.ok ? cookieFrom(res) : "" };
}

const envBackup = { ...process.env };
afterEach(() => {
  for (const k of [
    "NODE_ENV",
    "SMS_PROVIDER",
    "E2E_TEST_MODE",
    "MSG91_AUTH_KEY",
    "MSG91_OTP_TEMPLATE_ID",
  ]) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
});

describe("phone number helpers", () => {
  it("normalises Indian mobiles to E.164 and rejects everything else", () => {
    expect(toE164IndianMobile("98450 12345")).toBe(PHONE);
    expect(toE164IndianMobile("+91-98450-12345")).toBe(PHONE);
    expect(toE164IndianMobile("09845012345")).toBe(PHONE);
    expect(toE164IndianMobile("5845012345")).toBeNull();
    expect(toE164IndianMobile("984501234")).toBeNull();
    expect(phonePlaceholderEmail(PHONE)).toBe("919845012345@phone.invalid");
    expect(isPlaceholderEmail("919845012345@phone.invalid")).toBe(true);
    expect(isPlaceholderEmail("asha@example.com")).toBe(false);
    expect(formatIndianMobile(PHONE)).toBe("+91 98450 12345");
  });
});

describe("sign-in with mobile number + OTP", () => {
  it("creates a customer on first sign-in with a placeholder email and a session", async () => {
    const { res, cookie } = await signInWithPhone();
    expect(res.status).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { phoneNumber: PHONE } });
    expect(user.role).toBe("CUSTOMER");
    expect(user.phoneNumberVerified).toBe(true);
    expect(user.email).toBe("919845012345@phone.invalid");
    expect(user.phone).toBe("9845012345"); // delivery contact filled from the verified number
    expect(await db.account.count({ where: { userId: user.id, providerId: "credential" } })).toBe(
      0,
    );

    const session = await getUserFromHeaders(new Headers({ cookie }));
    expect(session).toMatchObject({ id: user.id, phoneNumber: PHONE, hasPlaceholderEmail: true });
  });

  it("signs an existing customer into the same account", async () => {
    await signInWithPhone();
    const first = await db.user.findUniqueOrThrow({ where: { phoneNumber: PHONE } });
    await db.outboundSms.deleteMany(); // clear the resend throttle
    const { res } = await signInWithPhone();
    expect(res.status).toBe(200);
    expect(await db.user.count()).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { phoneNumber: PHONE } })).id).toBe(first.id);
  });

  it("ignores role and status sent in the verify body", async () => {
    await sendOtp(PHONE);
    const res = await verify(PHONE, await latestCode(PHONE), {
      role: "ADMIN",
      status: "ACTIVE",
      adminRoleId: "owner",
    });
    const user = await db.user.findUnique({ where: { phoneNumber: PHONE } });
    if (res.ok) {
      expect(user?.role).toBe("CUSTOMER");
      expect(user?.adminRoleId).toBeNull();
    } else expect(user).toBeNull();
  });

  it("rejects a wrong code and locks the code after three wrong attempts", async () => {
    await sendOtp(PHONE);
    const code = await latestCode(PHONE);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) expect((await verify(PHONE, wrong)).status).toBe(400);
    const res = await verify(PHONE, code);
    expect(res.ok).toBe(false);
    expect(await db.user.count()).toBe(0);
  });

  it("does not accept a code twice", async () => {
    await sendOtp(PHONE);
    const code = await latestCode(PHONE);
    expect((await verify(PHONE, code)).status).toBe(200);
    expect((await verify(PHONE, code)).ok).toBe(false);
  });

  it("rejects numbers that are not valid Indian mobiles without sending an SMS", async () => {
    for (const p of ["9845012345", "+15551234567", "+915845012345", "+91984501234"]) {
      expect((await sendOtp(p)).status).toBe(400);
    }
    expect(await db.outboundSms.count()).toBe(0);
  });

  it("throttles codes per number (30 s between sends, 5 per hour)", async () => {
    expect((await sendOtp(PHONE)).status).toBe(200);
    expect((await sendOtp(PHONE)).status).toBe(429);

    await db.outboundSms.deleteMany();
    const old = new Date(Date.now() - 10 * 60_000);
    await db.outboundSms.createMany({
      data: Array.from({ length: 5 }, () => ({
        to: PHONE,
        template: "login-otp",
        body: "x",
        provider: "dev-outbox",
        status: "SENT_DEV",
        createdAt: old,
      })),
    });
    const res = await sendOtp(PHONE);
    expect(res.status).toBe(429);
    expect(await res.text()).toMatch(/in an hour/);
    // A different number is unaffected.
    expect((await sendOtp("+919876543210")).status).toBe(200);
  });

  it("never lets staff sign in with an SMS code", async () => {
    const { user } = await createAdmin("staff-phone@test.local");
    await db.user.update({
      where: { id: user.id },
      data: { phoneNumber: PHONE, phoneNumberVerified: true },
    });
    const sessionsBefore = await db.session.count({ where: { userId: user.id } });
    const { res } = await signInWithPhone();
    expect(res.status).toBe(403);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(sessionsBefore);
  });

  it("refuses disabled customers", async () => {
    await signInWithPhone();
    await db.user.update({ where: { phoneNumber: PHONE }, data: { status: "DISABLED" } });
    await db.outboundSms.deleteMany();
    const { res } = await signInWithPhone();
    expect(res.status).toBe(403);
  });

  it("disables the phone + password and phone password-reset endpoints", async () => {
    for (const [path, body] of [
      ["/sign-in/phone-number", { phoneNumber: PHONE, password: "Passw0rd!test" }],
      ["/phone-number/request-password-reset", { phoneNumber: PHONE }],
      [
        "/phone-number/reset-password",
        { phoneNumber: PHONE, otp: "123456", newPassword: "Passw0rd!x" },
      ],
    ] as const) {
      expect((await authRequest(path, body)).status).toBe(404);
    }
  });

  it("is unavailable in production without a real SMS gateway", async () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    delete process.env.E2E_TEST_MODE;
    process.env.SMS_PROVIDER = "dev-outbox";
    const res = await sendOtp(PHONE);
    expect(res.status).toBe(503);
    expect(await db.outboundSms.count()).toBe(0);
  });
});

describe("adding a sign-in number to an email account", () => {
  it("links a verified number to the signed-in account", async () => {
    const { user, cookie } = await registerCustomer("linker@example.com");
    await sendOtp(PHONE);
    const res = await verify(PHONE, await latestCode(PHONE), { updatePhoneNumber: true }, cookie);
    expect(res.status).toBe(200);
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated).toMatchObject({
      phoneNumber: PHONE,
      phoneNumberVerified: true,
      email: "linker@example.com",
    });

    // Signing in by phone now opens the same account.
    await db.outboundSms.deleteMany();
    const { cookie: phoneCookie } = await signInWithPhone();
    expect((await getUserFromHeaders(new Headers({ cookie: phoneCookie })))?.id).toBe(user.id);
  });

  it("refuses a number that belongs to another account", async () => {
    await signInWithPhone();
    const { user, cookie } = await registerCustomer("other@example.com");
    await db.outboundSms.deleteMany();
    await sendOtp(PHONE);
    const res = await verify(PHONE, await latestCode(PHONE), { updatePhoneNumber: true }, cookie);
    expect(res.status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).phoneNumber).toBeNull();
  });

  it("does not let update-user set a phone number without a code", async () => {
    const { user, cookie } = await registerCustomer("sneaky-phone@example.com");
    const res = await authRequest("/update-user", { phoneNumber: PHONE }, cookie);
    expect(res.ok).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).phoneNumber).toBeNull();
  });
});

describe("placeholder emails", () => {
  it("are never mailed", async () => {
    const result = await deliverEmail({
      to: phonePlaceholderEmail(PHONE),
      subject: "Hi",
      template: "test",
      text: "Hello",
    });
    expect(result.provider).toBe("skipped");
    expect(await db.outboundEmail.count()).toBe(0);
  });
});

describe("MSG91 provider", () => {
  function fakeFetch(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("needs an auth key and a DLT template id", () => {
    delete process.env.MSG91_AUTH_KEY;
    expect(() => msg91Provider()).toThrow(SmsDeliveryError);
  });

  it("posts the code to the Flow API and records the send without the code", async () => {
    process.env.MSG91_AUTH_KEY = "test-auth-key";
    process.env.MSG91_OTP_TEMPLATE_ID = "tmpl_123";
    const { impl, calls } = fakeFetch(200, {
      type: "success",
      message: "3763646c3058373530393938",
    });
    await msg91Provider(impl).send({ to: PHONE, template: "login-otp", vars: { otp: "482913" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://control.msg91.com/api/v5/flow");
    expect((calls[0]!.init.headers as Record<string, string>).authkey).toBe("test-auth-key");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      template_id: "tmpl_123",
      short_url: "0",
      recipients: [{ mobiles: "919845012345", otp: "482913" }],
    });
    const rows = await db.outboundSms.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).not.toContain("482913");
  });

  it("surfaces provider rejections and HTTP failures (no retry)", async () => {
    process.env.MSG91_AUTH_KEY = "test-auth-key";
    process.env.MSG91_OTP_TEMPLATE_ID = "tmpl_123";
    const rejected = fakeFetch(200, { type: "error", message: "Template not approved" });
    await expect(
      msg91Provider(rejected.impl).send({ to: PHONE, template: "login-otp", vars: { otp: "1" } }),
    ).rejects.toThrow(/Template not approved/);
    const down = fakeFetch(503, { message: "unavailable" });
    await expect(
      msg91Provider(down.impl).send({ to: PHONE, template: "login-otp", vars: { otp: "1" } }),
    ).rejects.toBeInstanceOf(SmsDeliveryError);
    expect(down.calls).toHaveLength(1);
    expect(await db.outboundSms.count()).toBe(0);
  });
});
