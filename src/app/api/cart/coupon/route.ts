import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { cartIdentityFromRequest } from "@/server/modules/cart/request";
import { clientIp } from "@/server/modules/audit/audit";
import { applyCoupon, removeCoupon } from "@/server/modules/cart/cart";
import { enforceRateLimit } from "@/server/platform/rate-limit";

const schema = z.object({
  code: z
    .string()
    .trim()
    .min(3, "Enter a coupon code")
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, "Invalid coupon code"),
});

export const POST = route(async (req) => {
  const { identity, userId } = await cartIdentityFromRequest(req);
  // Throttle guessing of coupon codes.
  await enforceRateLimit(`coupon:${userId ?? clientIp(req) ?? "anon"}`, 15, 600);
  const { code } = await parseJson(req, schema);
  const view = await applyCoupon(identity, code);
  return ok({ code: view.coupon.code, discountPaise: view.pricing.couponDiscountPaise });
});

export const DELETE = route(async (req) => {
  const { identity } = await cartIdentityFromRequest(req);
  await removeCoupon(identity);
  return ok({ removed: true });
});
