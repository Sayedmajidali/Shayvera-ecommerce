import "server-only";
import { cookies } from "next/headers";

export const CART_COOKIE = "shv_cart";
export const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** Guest cart token from the httpOnly cookie (Server Components / Route Handlers). */
export async function readGuestToken(): Promise<string | null> {
  const value = (await cookies()).get(CART_COOKIE)?.value;
  return value && /^[a-zA-Z0-9_-]{20,64}$/.test(value) ? value : null;
}

export function guestTokenFromRequest(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${CART_COOKIE}=([^;]+)`));
  const value = match?.[1];
  return value && /^[a-zA-Z0-9_-]{20,64}$/.test(value) ? value : null;
}

export function guestCookieHeader(token: string): string {
  const secure = (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://") ? "; Secure" : "";
  return `${CART_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CART_COOKIE_MAX_AGE}${secure}`;
}

export function clearGuestCookieHeader(): string {
  return `${CART_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
