import { ok, parseJson, route } from "@/lib/api";
import { requireUser } from "@/server/modules/auth/session";
import {
  addToWishlist,
  wishlistAddSchema,
  wishlistProductIds,
} from "@/server/modules/wishlist/wishlist";
import { enforceRateLimit } from "@/server/platform/rate-limit";

/** Returns the signed-in user's wishlisted product ids (for heart buttons). */
export const GET = route(
  async (req) => {
    const user = await requireUser(req);
    return ok(
      { productIds: await wishlistProductIds(user.id) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
  { csrf: false },
);

export const POST = route(async (req) => {
  const user = await requireUser(req);
  await enforceRateLimit(`wishlist:${user.id}`, 120, 60);
  const { productId } = await parseJson(req, wishlistAddSchema);
  return ok(await addToWishlist(user.id, productId), 201);
});
