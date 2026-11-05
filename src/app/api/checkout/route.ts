import { ok, parseJson, route } from "@/lib/api";
import { checkoutSchema } from "@/lib/validation/checkout";
import { cartIdentityFromRequest } from "@/server/cart/request";
import { clientIp } from "@/server/services/audit";
import { placeOrder } from "@/server/services/checkout";
import { enforceRateLimit } from "@/server/services/rate-limit";

/** Places an order from the server-side cart. The request never contains prices or totals. */
export const POST = route(async (req) => {
  const { identity, userId } = await cartIdentityFromRequest(req);
  await enforceRateLimit(`checkout:${userId ?? clientIp(req) ?? "anon"}`, 10, 300);
  const input = await parseJson(req, checkoutSchema, 32 * 1024);
  const result = await placeOrder(input, { identity, userId });
  return ok(result, result.idempotentReplay ? 200 : 201);
});
