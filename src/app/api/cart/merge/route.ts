import { ok, route } from "@/lib/api";
import { requireUser } from "@/server/auth/session";
import { clearGuestCookieHeader, guestTokenFromRequest } from "@/server/cart/identity";
import { mergeGuestCart } from "@/server/services/cart";

/** Called right after sign-in/sign-up: merges the guest cart into the user's cart. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  await mergeGuestCart(user.id, guestTokenFromRequest(req));
  const res = ok({ merged: true });
  res.headers.append("Set-Cookie", clearGuestCookieHeader());
  return res;
});
