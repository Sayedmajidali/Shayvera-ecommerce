import { ok, route, type RouteCtx } from "@/lib/api";
import { requireUser } from "@/server/modules/auth/session";
import { removeFromWishlist } from "@/server/modules/wishlist/wishlist";

export const DELETE = route<RouteCtx<{ productId: string }>>(async (req, { params }) => {
  const user = await requireUser(req);
  return ok(await removeFromWishlist(user.id, (await params).productId));
});
