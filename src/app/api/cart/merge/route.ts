import { ok, route } from "@/lib/api";
import { requireUser } from "@/server/modules/auth/session";
import { clearGuestCookieHeader, guestTokenFromRequest } from "@/server/modules/cart/identity";
import { mergeGuestCart } from "@/server/modules/cart/cart";

/** Called right after sign-in/sign-up: merges the guest cart into the user's cart. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  await mergeGuestCart(user.id, guestTokenFromRequest(req));
  const res = ok({ merged: true });
  res.headers.append("Set-Cookie", clearGuestCookieHeader());
  return res;
});
