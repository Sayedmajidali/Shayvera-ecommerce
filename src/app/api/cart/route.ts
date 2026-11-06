import { z } from "zod";
import { ok, parseSearchParams, route } from "@/lib/api";
import { STATE_CODES } from "@/lib/india";
import { cartIdentityFromRequest } from "@/server/modules/cart/request";
import { getCartView } from "@/server/modules/cart/cart";
import { couponCodeInput } from "@/lib/validation/checkout";

const query = z.object({
  state: z.enum(STATE_CODES).optional().catch(undefined),
  payment: z.enum(["COD", "RAZORPAY"]).optional().catch(undefined),
  buy: z.string().trim().min(1).max(64).optional().catch(undefined),
  qty: z.coerce.number().int().min(1).max(10).optional().catch(undefined),
  coupon: couponCodeInput.catch(null),
});

/**
 * Returns the validated, server-priced cart. Optional ?state=KA&payment=COD for checkout previews.
 * With ?buy=<variantId>&qty=<n>[&coupon=CODE] it prices a single "Buy now" item instead.
 */
export const GET = route(
  async (req) => {
    const { identity, email } = await cartIdentityFromRequest(req);
    const q = parseSearchParams(req.url, query);
    const view = await getCartView(identity, {
      shippingStateCode: q.state,
      paymentMethod: q.payment,
      email,
      ...(q.buy
        ? { buyNow: { variantId: q.buy, quantity: q.qty ?? 1 }, couponOverride: q.coupon }
        : {}),
    });
    return ok(view, { headers: { "Cache-Control": "no-store" } });
  },
  { csrf: false },
);
