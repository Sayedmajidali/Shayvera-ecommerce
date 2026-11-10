import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import { getUserFromHeaders } from "@/server/modules/auth/session";
import { inviteStaff } from "@/server/modules/auth/staff";
import { authRequest, createAdmin, latestEmailCode, signIn, TEST_PASSWORD } from "../helpers/auth";

const signUp = (email: string, password = TEST_PASSWORD) =>
  authRequest("/sign-up/email", { email, password, name: "Asha Rao" });
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

describe("sign-up email verification (6-digit code)", () => {
  it("emails a code, keeps the account signed out until the code is confirmed, then signs in", async () => {
    const res = await signUp("new@example.com");
    expect(res.ok).toBe(true);
    expect((await res.json()).token).toBeNull(); // no session before verification
    const user = await db.user.findUniqueOrThrow({ where: { email: "new@example.com" } });
    expect(user.emailVerified).toBe(false);

    const mail = await db.outboundEmail.findFirstOrThrow({
      where: { to: "new@example.com", template: "auth-email-verification" },
    });
    expect(mail.subject).toBe("Your Shayvera verification code");
    expect(mail.html).toContain("/brand/email-logo.png"); // branded layout

    // Password sign-in is refused until verified (and sends a fresh code).
    const early = await signIn("new@example.com");
    expect(early.res.status).toBe(403);
    expect((await early.res.json()).code).toBe("EMAIL_NOT_VERIFIED");
    expect(
      await db.outboundEmail.count({
        where: { to: "new@example.com", template: "auth-email-verification" },
      }),
    ).toBe(2);

    const wrong = await authRequest("/email-otp/verify-email", {
      email: "new@example.com",
      otp: "000000",
    });
    expect(wrong.ok).toBe(false);

    const otp = await latestEmailCode("new@example.com");
    const ok = await authRequest("/email-otp/verify-email", { email: "new@example.com", otp });
    expect(ok.ok).toBe(true);
    const session = await getUserFromHeaders(new Headers({ cookie: cookieOf(ok) }));
    expect(session?.email).toBe("new@example.com");
    expect(
      (await db.user.findUniqueOrThrow({ where: { email: "new@example.com" } })).emailVerified,
    ).toBe(true);
    expect((await signIn("new@example.com")).res.ok).toBe(true);
  });

  it("locks a code after too many wrong attempts and stores codes hashed", async () => {
    await signUp("brute@example.com");
    const otp = await latestEmailCode("brute@example.com");
    const stored = await db.verification.findFirstOrThrow({
      where: { identifier: { contains: "brute@example.com" } },
    });
    expect(stored.value).not.toContain(otp); // hashed, never the plain code
    for (let i = 0; i < 5; i++)
      await authRequest("/email-otp/verify-email", { email: "brute@example.com", otp: "111111" });
    const after = await authRequest("/email-otp/verify-email", { email: "brute@example.com", otp });
    expect(after.ok).toBe(false);
  });

  it("does not offer passwordless email sign-in or email change", async () => {
    for (const path of [
      "/sign-in/email-otp",
      "/email-otp/change-email",
      "/forget-password/email-otp",
    ]) {
      const res = await authRequest(path, { email: "x@example.com", otp: "123456" });
      expect(res.status).toBe(404);
    }
  });
});

describe("forgot password with an emailed code", () => {
  it("resets the password with the code, signs out other sessions, and the code works once", async () => {
    const { cookie } = await (async () => {
      await signUp("forgot@example.com");
      const otp = await latestEmailCode("forgot@example.com");
      const v = await authRequest("/email-otp/verify-email", { email: "forgot@example.com", otp });
      return { cookie: cookieOf(v) };
    })();

    const req = await authRequest("/email-otp/request-password-reset", {
      email: "forgot@example.com",
    });
    expect(req.ok).toBe(true);
    const otp = await latestEmailCode("forgot@example.com", "forget-password");

    const weak = await authRequest("/email-otp/reset-password", {
      email: "forgot@example.com",
      otp,
      password: "onlyletters",
    });
    expect(weak.ok).toBe(false); // same password rules as sign-up

    const reset = await authRequest("/email-otp/reset-password", {
      email: "forgot@example.com",
      otp,
      password: "NewPassw0rd!",
    });
    expect(reset.ok).toBe(true);
    expect(await getUserFromHeaders(new Headers({ cookie }))).toBeNull(); // old sessions revoked
    expect((await signIn("forgot@example.com", "NewPassw0rd!")).res.ok).toBe(true);
    expect((await signIn("forgot@example.com")).res.status).toBe(401);

    const reuse = await authRequest("/email-otp/reset-password", {
      email: "forgot@example.com",
      otp,
      password: "Another1pass",
    });
    expect(reuse.ok).toBe(false);
  });

  it("does not reveal whether an email has an account", async () => {
    const res = await authRequest("/email-otp/request-password-reset", {
      email: "nobody@example.com",
    });
    expect(res.ok).toBe(true);
    expect(await db.outboundEmail.count({ where: { to: "nobody@example.com" } })).toBe(0);
  });
});

describe("existing accounts are not locked out", () => {
  it("staff who set their password from the invitation can sign in (reset marks the email verified)", async () => {
    const { user: owner } = await createAdmin();
    await inviteStaff(
      { email: "staff@example.com", name: "Staff One", roleId: owner.adminRoleId! },
      { id: owner.id, ip: null },
    );
    const invite = await db.outboundEmail.findFirstOrThrow({
      where: { to: "staff@example.com", template: "staff-invite" },
    });
    const token = invite.text.match(/reset-password\/([^?\s]+)/)?.[1];
    const set = await authRequest("/reset-password", { newPassword: TEST_PASSWORD, token });
    expect(set.ok).toBe(true);
    expect(
      (await db.user.findUniqueOrThrow({ where: { email: "staff@example.com" } })).emailVerified,
    ).toBe(true);
    expect((await signIn("staff@example.com")).res.ok).toBe(true);
  });
});
