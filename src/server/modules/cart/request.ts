import "server-only";
import { getUserFromHeaders } from "@/server/modules/auth/session";
import type { CartIdentity } from "@/server/modules/cart/cart";
import { guestCookieHeader, guestTokenFromRequest } from "./identity";

/** Cart owner for this request: signed-in user, else the guest cookie token (may be null). */
export async function cartIdentityFromRequest(
  req: Request,
): Promise<{ identity: CartIdentity; userId: string | null; email: string | null }> {
  const user = await getUserFromHeaders(req.headers);
  if (user) return { identity: { userId: user.id }, userId: user.id, email: user.email };
  return { identity: { guestToken: guestTokenFromRequest(req) }, userId: null, email: null };
}

export function withGuestCookie(res: Response, token: string | null): Response {
  if (token) res.headers.append("Set-Cookie", guestCookieHeader(token));
  return res;
}
