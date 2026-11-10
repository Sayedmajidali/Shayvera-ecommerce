import { auth } from "@/lib/auth";
import { db } from "@/server/platform/db";
import { provisionAdmin } from "@/server/modules/auth/admin-provisioning";

const BASE = "http://localhost:3000";

export const TEST_PASSWORD = "Passw0rd!test";

/** Calls the real Better Auth HTTP handler, returning the response. */
export async function authRequest(path: string, body: unknown, cookie?: string) {
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

export function cookieFrom(res: Response): string {
  const cookies = res.headers.getSetCookie();
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

/** The latest 6-digit code emailed to `email` for `purpose` (read from the dev outbox). */
export async function latestEmailCode(
  email: string,
  purpose: "email-verification" | "forget-password" = "email-verification",
) {
  const mail = await db.outboundEmail.findFirst({
    where: { to: email.toLowerCase(), template: `auth-${purpose}` },
    orderBy: { createdAt: "desc" },
  });
  const code = mail?.text.match(/Your code: (\d{6})/)?.[1];
  if (!code) throw new Error(`no ${purpose} code emailed to ${email}`);
  return code;
}

/** Signs up like a customer: create the account, then confirm the emailed code (signs in). */
export async function registerCustomer(email: string, name = "Test Customer") {
  const res = await authRequest("/sign-up/email", { email, password: TEST_PASSWORD, name });
  if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const otp = await latestEmailCode(email);
  const verified = await authRequest("/email-otp/verify-email", { email, otp });
  if (!verified.ok)
    throw new Error(`verification failed: ${verified.status} ${await verified.text()}`);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return { user, cookie: cookieFrom(verified) };
}

export async function signIn(email: string, password = TEST_PASSWORD) {
  const res = await authRequest("/sign-in/email", { email, password });
  return { res, cookie: res.ok ? cookieFrom(res) : "" };
}

export async function createAdmin(email = "admin@test.local") {
  await provisionAdmin({ email, name: "Test Admin", password: TEST_PASSWORD });
  const { cookie } = await signIn(email);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return { user, cookie };
}

/** Builds a same-origin request to a route handler, optionally authenticated. */
export function apiRequest(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
) {
  const method = init.method ?? "GET";
  return new Request(`${BASE}${path}`, {
    method,
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" ? { origin: BASE } : {}),
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
