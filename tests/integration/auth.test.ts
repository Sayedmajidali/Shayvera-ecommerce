import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import { auth } from "@/lib/auth";
import {
  TEST_PASSWORD,
  apiRequest,
  authRequest,
  cookieFrom,
  createAdmin,
  params,
  registerCustomer,
  signIn,
} from "../helpers/auth";
import * as profileRoute from "@/app/api/account/profile/route";
import * as addressesRoute from "@/app/api/account/addresses/route";
import * as addressRoute from "@/app/api/account/addresses/[id]/route";
import { getUserFromHeaders } from "@/server/modules/auth/session";

const address = {
  fullName: "Asha Rao",
  phone: "+91 98450 12345",
  line1: "12 MG Road",
  city: "Bengaluru",
  stateCode: "KA",
  pincode: "560001",
};

describe("registration & login", () => {
  it("registers a customer with role CUSTOMER and hashes the password", async () => {
    const { user, cookie } = await registerCustomer("asha@example.com");
    expect(user.role).toBe("CUSTOMER");
    expect(cookie).toContain("better-auth.session_token");
    const account = await db.account.findFirstOrThrow({ where: { userId: user.id } });
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(TEST_PASSWORD);
  });

  it("ignores a role field sent during sign-up (no privilege escalation)", async () => {
    const res = await authRequest("/sign-up/email", {
      email: "sneaky@example.com",
      password: TEST_PASSWORD,
      name: "Sneaky",
      role: "ADMIN",
    });
    const user = await db.user.findUnique({ where: { email: "sneaky@example.com" } });
    // Better Auth either rejects the unknown field or ignores it; either way no admin is created.
    if (res.ok) expect(user?.role).toBe("CUSTOMER");
    else expect(user).toBeNull();
  });

  it("rejects duplicate registration and weak passwords", async () => {
    await registerCustomer("dup@example.com");
    const dup = await authRequest("/sign-up/email", {
      email: "dup@example.com",
      password: TEST_PASSWORD,
      name: "X",
    });
    // Requiring verification makes duplicate sign-ups look like success (no account enumeration):
    // no second account is created, and the real owner gets an "account exists" email.
    expect(dup.ok).toBe(true);
    expect((await dup.json()).token).toBeNull();
    expect(await db.user.count({ where: { email: "dup@example.com" } })).toBe(1);
    expect(
      await db.outboundEmail.count({
        where: { to: "dup@example.com", template: "auth-account-exists" },
      }),
    ).toBe(1);
    const weak = await authRequest("/sign-up/email", {
      email: "weak@example.com",
      password: "123",
      name: "X",
    });
    expect(weak.ok).toBe(false);
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    await registerCustomer("login@example.com");
    expect((await signIn("login@example.com")).res.ok).toBe(true);
    expect((await signIn("login@example.com", "wrong-password1")).res.status).toBe(401);
  });

  it("persists sessions and invalidates them on sign-out", async () => {
    const { cookie } = await registerCustomer("session@example.com");
    const headers = new Headers({ cookie });
    expect((await getUserFromHeaders(headers))?.email).toBe("session@example.com");
    const out = await authRequest("/sign-out", {}, cookie);
    expect(out.ok).toBe(true);
    expect(await getUserFromHeaders(headers)).toBeNull();
  });

  it("blocks disabled accounts from signing in and from existing sessions", async () => {
    const { user, cookie } = await registerCustomer("disabled@example.com");
    await db.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
    expect(await getUserFromHeaders(new Headers({ cookie }))).toBeNull();
    const { res } = await signIn("disabled@example.com");
    expect(res.ok).toBe(false);
  });
});

describe("password reset", () => {
  it("emails a reset link, accepts the token once and revokes sessions", async () => {
    const { cookie } = await registerCustomer("reset@example.com");
    const req = await authRequest("/request-password-reset", {
      email: "reset@example.com",
      redirectTo: "/reset-password",
    });
    expect(req.ok).toBe(true);
    const email = await db.outboundEmail.findFirstOrThrow({
      where: { to: "reset@example.com", template: "password-reset" },
    });
    const token = email.text.match(/reset-password\/([^?\s]+)/)?.[1];
    expect(token).toBeTruthy();

    const reset = await authRequest("/reset-password", { newPassword: "NewPassw0rd!", token });
    expect(reset.ok).toBe(true);
    expect(await getUserFromHeaders(new Headers({ cookie }))).toBeNull();
    expect((await signIn("reset@example.com", "NewPassw0rd!")).res.ok).toBe(true);
    const reuse = await authRequest("/reset-password", { newPassword: "Another1pass", token });
    expect(reuse.ok).toBe(false);
  });

  it("does not reveal whether an email exists", async () => {
    const res = await authRequest("/request-password-reset", {
      email: "nobody@example.com",
      redirectTo: "/reset-password",
    });
    expect(res.ok).toBe(true);
    expect(await db.outboundEmail.count()).toBe(0);
  });
});

describe("admin provisioning & RBAC", () => {
  it("provisions an admin that can sign in", async () => {
    const { user, cookie } = await createAdmin();
    expect(user.role).toBe("ADMIN");
    const session = await getUserFromHeaders(new Headers({ cookie }));
    expect(session?.role).toBe("ADMIN");
  });

  it("does not expose an admin role via the session update endpoint", async () => {
    const { cookie, user } = await registerCustomer("upd@example.com");
    await auth.handler(
      new Request("http://localhost:3000/api/auth/update-user", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
        body: JSON.stringify({ role: "ADMIN", name: "Hacker" }),
      }),
    );
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.role).toBe("CUSTOMER");
  });
});

describe("account API authorization & data isolation", () => {
  it("rejects unauthenticated profile access with 401", async () => {
    const res = await profileRoute.GET(apiRequest("/api/account/profile"), undefined);
    expect(res.status).toBe(401);
  });

  it("rejects cross-origin state-changing requests (CSRF)", async () => {
    const { cookie } = await registerCustomer("csrf@example.com");
    const req = new Request("http://localhost:3000/api/account/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, origin: "https://evil.example" },
      body: JSON.stringify({ name: "Evil" }),
    });
    const res = await profileRoute.PATCH(req, undefined);
    expect(res.status).toBe(403);
  });

  it("validates and updates the profile", async () => {
    const { cookie } = await registerCustomer("profile@example.com");
    const bad = await profileRoute.PATCH(
      apiRequest("/api/account/profile", {
        method: "PATCH",
        cookie,
        body: { name: "A", phone: "12345" },
      }),
      undefined,
    );
    expect(bad.status).toBe(400);
    const good = await profileRoute.PATCH(
      apiRequest("/api/account/profile", {
        method: "PATCH",
        cookie,
        body: { name: "Asha Rao", phone: "+91 98450 12345" },
      }),
      undefined,
    );
    expect(good.status).toBe(200);
    expect((await good.json()).data.phone).toBe("9845012345");
  });

  it("prevents customers from reading or modifying another customer's addresses", async () => {
    const a = await registerCustomer("a@example.com");
    const b = await registerCustomer("b@example.com");
    const created = await addressesRoute.POST(
      apiRequest("/api/account/addresses", { method: "POST", cookie: a.cookie, body: address }),
      undefined,
    );
    expect(created.status).toBe(201);
    const addr = (await created.json()).data;
    expect(addr.isDefault).toBe(true);

    const listB = await addressesRoute.GET(
      apiRequest("/api/account/addresses", { cookie: b.cookie }),
      undefined,
    );
    expect((await listB.json()).data).toHaveLength(0);

    const updB = await addressRoute.PUT(
      apiRequest(`/api/account/addresses/${addr.id}`, {
        method: "PUT",
        cookie: b.cookie,
        body: { ...address, city: "Hacked" },
      }),
      params({ id: addr.id }),
    );
    expect(updB.status).toBe(404);
    const delB = await addressRoute.DELETE(
      apiRequest(`/api/account/addresses/${addr.id}`, { method: "DELETE", cookie: b.cookie }),
      params({ id: addr.id }),
    );
    expect(delB.status).toBe(404);
    expect(await db.address.count({ where: { id: addr.id } })).toBe(1);
  });

  it("rejects invalid Indian PIN codes and states", async () => {
    const { cookie } = await registerCustomer("pin@example.com");
    const res = await addressesRoute.POST(
      apiRequest("/api/account/addresses", {
        method: "POST",
        cookie,
        body: { ...address, pincode: "012345", stateCode: "XX" },
      }),
      undefined,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.details).toHaveProperty("pincode");
    expect(body.error.details).toHaveProperty("stateCode");
  });
});

void cookieFrom;
