import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { provisionAdmin } from "@/server/services/admin-provisioning";

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

export async function registerCustomer(email: string, name = "Test Customer") {
  const res = await authRequest("/sign-up/email", { email, password: TEST_PASSWORD, name });
  if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return { user, cookie: cookieFrom(res) };
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
