import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { cartIdentityFromRequest, withGuestCookie } from "@/server/modules/cart/request";
import { addItem, MAX_QTY_PER_LINE } from "@/server/modules/cart/cart";

const schema = z.object({
  variantId: z.string().trim().min(1).max(64),
  quantity: z.coerce.number().int().min(1).max(MAX_QTY_PER_LINE).default(1),
});

export const POST = route(async (req) => {
  const { identity } = await cartIdentityFromRequest(req);
  const { variantId, quantity } = await parseJson(req, schema);
  const { createdToken } = await addItem(identity, variantId, quantity);
  return withGuestCookie(ok({ added: true }, 201), createdToken);
});
