import { z } from "zod";
import { ok, parseSearchParams, route } from "@/lib/api";
import { STATE_CODES } from "@/lib/india";
import { cartIdentityFromRequest } from "@/server/cart/request";
import { getCartView } from "@/server/services/cart";

const query = z.object({
  state: z.enum(STATE_CODES).optional().catch(undefined),
  payment: z.enum(["COD", "RAZORPAY"]).optional().catch(undefined),
});

/** Returns the validated, server-priced cart. Optional ?state=KA&payment=COD for checkout previews. */
export const GET = route(
  async (req) => {
    const { identity, email } = await cartIdentityFromRequest(req);
    const q = parseSearchParams(req.url, query);
    const view = await getCartView(identity, {
      shippingStateCode: q.state,
      paymentMethod: q.payment,
      email,
    });
    return ok(view, { headers: { "Cache-Control": "no-store" } });
  },
  { csrf: false },
);
