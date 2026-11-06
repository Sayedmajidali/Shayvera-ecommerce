import { z } from "zod";
import { ok, parseSearchParams, route } from "@/lib/api";
import { pincodeSchema } from "@/lib/validation/common";
import { clientIp } from "@/server/modules/audit/audit";
import { getCartView } from "@/server/modules/cart/cart";
import { cartIdentityFromRequest } from "@/server/modules/cart/request";
import { checkDelivery } from "@/server/modules/shipping/serviceability";
import { enforceRateLimit } from "@/server/platform/rate-limit";

const query = z.object({
  pincode: pincodeSchema,
  buy: z.string().trim().min(1).max(64).optional().catch(undefined),
  qty: z.coerce.number().int().min(1).max(10).optional().catch(undefined),
});

/**
 * Delivery check for the checkout page: courier coverage, COD availability and an estimate for the
 * current cart (or a "Buy now" item) to the given PIN code. Never exposes courier rates.
 */
export const GET = route(
  async (req) => {
    await enforceRateLimit(`svc:${clientIp(req) ?? "unknown"}`, 60, 60);
    const q = parseSearchParams(req.url, query);
    const { identity, email } = await cartIdentityFromRequest(req);
    const view = await getCartView(identity, {
      email,
      ...(q.buy ? { buyNow: { variantId: q.buy, quantity: q.qty ?? 1 } } : {}),
    });
    const result = await checkDelivery(
      q.pincode,
      view.lines
        .filter((l) => l.purchasable)
        .map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          unitPricePaise: l.unitPricePaise,
        })),
    );
    const body =
      result.status === "serviceable"
        ? { status: result.status, codAvailable: result.codAvailable, etaDays: result.etaDays }
        : { status: result.status, codAvailable: null, etaDays: null };
    return ok(body, { headers: { "Cache-Control": "no-store" } });
  },
  { csrf: false },
);
